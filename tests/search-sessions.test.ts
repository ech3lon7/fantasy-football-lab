import { describe, expect, it } from "vitest";
import { createSearchSessions } from "../src/features/next/trade/search-sessions";

// Record worker messages and termination without starting a real search.
class FakeWorker {
  messages: unknown[] = [];
  terminated = 0;
  postMessage(message: unknown) { this.messages.push(message); }
  terminate() { this.terminated++; }
}
const worker = () => new FakeWorker() as unknown as Worker & FakeWorker;
const job = { status: "running", rows: [] as string[] };

describe("search session lifecycle", () => {
  it("U1 retains a worker and accepts its result without a subscriber", () => {
    const s = createSearchSessions<typeof job>(); const w = worker();
    s.start("find", w, "a", "c", job);
    const unsubscribe = s.subscribe(() => {}); unsubscribe();
    s.update("find", "a", (p) => ({ ...p!, status: "complete", rows: ["result"] }));
    expect(s.get("find").worker).toBe(w); expect(w.terminated).toBe(0);
    expect(s.get("find").job?.rows).toEqual(["result"]);
  });
  it("U2 posts paging and details to the retained worker", () => {
    const s = createSearchSessions<typeof job>(); const w = worker(); s.start("find", w, "a", "c", job);
    s.post("find", "a", { type: "browse" }); s.post("find", "a", { type: "details" });
    expect(w.messages).toEqual([{ type: "browse" }, { type: "details" }]);
  });
  it("U3 ignores unchanged context and invalidates a changed context", () => {
    const s = createSearchSessions<typeof job>(); const w = worker(); s.start("chains", w, "a", "c", job);
    s.invalidate("chains", "c"); expect(w.terminated).toBe(0);
    s.invalidate("chains", "different"); expect(w.terminated).toBe(1); expect(s.get("chains").job?.status).toBe("stale");
  });
  it("U4 replaces only the worker of the same finder", () => {
    const s = createSearchSessions<typeof job>(); const a = worker(), b = worker(), c = worker();
    s.start("find", a, "a", "c", job); s.start("chains", c, "c", "c", job); s.start("find", b, "b", "c", job);
    expect(a.terminated).toBe(1); expect(c.terminated).toBe(0); expect(s.get("find").worker).toBe(b);
    s.update("find", "a", () => ({ status: "complete", rows: ["late"] })); expect(s.get("find").job).toEqual(job);
  });
  it("U5 disposes workers and clears both sessions", () => {
    const s = createSearchSessions<typeof job>(); const a = worker(), b = worker();
    s.start("find", a, "a", "c", job); s.start("chains", b, "b", "c", job); s.dispose();
    expect(a.terminated).toBe(1); expect(b.terminated).toBe(1); expect(s.get("find").job).toBeNull(); expect(s.get("chains").job).toBeNull();
  });
  it("U6 reports running only while at least one job runs", () => {
    const s = createSearchSessions<typeof job>(); const w = worker(); expect(s.running()).toBe(false);
    s.start("find", w, "a", "c", job); expect(s.running()).toBe(true);
    s.update("find", "a", (p) => ({ ...p!, status: "complete" })); expect(s.running()).toBe(false);
  });
  // An import retains stale results but discards late replies from the old worker.
  it("preserves stale results during import and rejects late messages", () => {
    const s = createSearchSessions<typeof job>(); const w = worker();
    s.start("find", w, "a", "old", { status: "complete", rows: ["old result"] });
    s.dispose(undefined, true);
    s.update("find", "a", () => ({ status: "complete", rows: ["late result"] }));
    expect(w.terminated).toBe(1); expect(s.get("find").job).toEqual({ status: "stale", rows: ["old result"] });
  });
});
