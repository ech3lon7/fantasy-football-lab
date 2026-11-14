// Retain search workers and their current snapshots outside any hidden React screen.
export type Finder = "find" | "chains";
export type SessionJob = { status: string };
export type SearchSession<J extends SessionJob> = { id: string | null; context: string | null; worker: Worker | null; job: J | null };

// Each store belongs to one app instance and keeps at most one worker per finder.
export function createSearchSessions<J extends SessionJob = SessionJob>() {
  const empty = (): SearchSession<J> => ({ id: null, context: null, worker: null, job: null });
  const sessions: Record<Finder, SearchSession<J>> = { find: empty(), chains: empty() };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const put = (finder: Finder, next: SearchSession<J>) => { sessions[finder] = next; emit(); };
  return {
    get: (finder: Finder) => sessions[finder],
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start(finder: Finder, worker: Worker, id: string, context: string, job: J) {
      sessions[finder].worker?.terminate(); put(finder, { id, context, worker, job });
    },
    update(finder: Finder, id: string, recipe: (job: J | null) => J | null) {
      const current = sessions[finder]; if (current.id !== id) return;
      put(finder, { ...current, job: recipe(current.job) });
    },
    // Apply UI updates to the current job without altering its worker ownership.
    setJob(finder: Finder, recipe: (job: J | null) => J | null) {
      const current = sessions[finder]; put(finder, { ...current, job: recipe(current.job) });
    },
    // A worker failure releases that worker while retaining its error result.
    fail(finder: Finder, id: string) {
      const current = sessions[finder]; if (current.id !== id) return;
      current.worker?.terminate(); put(finder, { ...current, id: null, worker: null });
    },
    post(finder: Finder, id: string, message: unknown) {
      const current = sessions[finder]; if (current.id === id) current.worker?.postMessage(message);
    },
    invalidate(finder: Finder, context: string) {
      const current = sessions[finder]; if (current.context === null || current.context === context) return;
      current.worker?.terminate(); put(finder, { ...current, id: null, worker: null, job: current.job ? { ...current.job, status: "stale" } : null });
    },
    cancel(finder: Finder) {
      const current = sessions[finder]; current.worker?.terminate();
      put(finder, { ...current, id: null, worker: null, job: current.job ? { ...current.job, status: "cancelled" } : null });
    },
    dispose(finder?: Finder, keepStale = false) {
      for (const key of finder ? [finder] : ["find", "chains"] as const) {
        const current = sessions[key]; current.worker?.terminate();
        put(key, keepStale && current.job ? { ...current, id: null, worker: null, job: { ...current.job, status: "stale" } } : empty());
      }
    },
    running: () => Object.values(sessions).some((session) => session.job?.status === "running"),
  };
}
