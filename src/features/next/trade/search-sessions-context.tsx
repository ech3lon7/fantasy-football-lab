import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createSearchSessions } from "./search-sessions";

type SearchSessions = ReturnType<typeof createSearchSessions>;
const Context = createContext<SearchSessions | null>(null);

// Own the search sessions above every Activity boundary and preserve stale results on an import.
export function SearchSessionsProvider({ owner, hash, children }: { owner: string | undefined; hash: string | undefined; children: React.ReactNode }) {
  const [sessions] = useState(() => createSearchSessions());
  const previous = useRef({ owner, hash });
  useEffect(() => {
    if (previous.current.owner !== owner) sessions.dispose();
    else if (previous.current.hash !== hash) sessions.dispose(undefined, true);
    previous.current = { owner, hash };
  }, [sessions, owner, hash]);
  // App teardown is the only effect cleanup that owns workers.
  useEffect(() => () => sessions.dispose(), [sessions]);
  return <Context.Provider value={sessions}>{children}</Context.Provider>;
}

// Search hooks and navigation controls share this app-owned session store.
export function useSearchSessions() {
  const sessions = useContext(Context);
  if (!sessions) throw new Error("Search sessions are unavailable");
  return sessions;
}
