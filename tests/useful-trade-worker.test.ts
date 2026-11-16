import { afterEach, expect, it, vi } from "vitest";
import { defaults } from "../src/domain/contracts";
import { defaultTradeFilters } from "../src/domain/trade-filters";
import { tradeSearchFixture } from "./fixtures";

// Exercise the actual worker handler with a fake message port and a small synthetic league.
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
it("streams one-for-ones before completing the broad search and reports measured coverage", async () => {
  const messages: any[] = [];
  // The row messages, without the per-opponent progress events.
  const rows = () => messages.filter((message) => message.type !== "team");
  const port: { postMessage: (message: any) => void; onmessage?: (event: any) => void } = { postMessage: (message) => messages.push(message) };
  vi.stubGlobal("self", port);
  await import("../src/workers/trade-search.worker");
  await port.onmessage!({ data: { type: "start", id: "1", context: "ctx", dataset: await tradeSearchFixture(),
    settings: defaults, evidence: "", roleWeight: "0", useful: { protectedIds: [] },
    query: { teamA: "1", give: [], count: 1, below: 0, above: 0, lineupBasis: "best-available" } } });
  expect(messages.filter((message) => message.type !== "team").map((message) => message.type)).toEqual(["partial", "complete"]);
  // Each opponent reports its one-for-ones and then its packages, for the search scene; the fixture has one opponent.
  const teamEvents = messages.filter((message) => message.type === "team");
  expect(teamEvents.map((e) => e.done)).toEqual([false, true]);
  expect(teamEvents[0].singles).toBeGreaterThan(0);
  expect(teamEvents[1].team).toBe(teamEvents[0].team);
  const result = rows()[1];
  // Every streamed and completed page uses the same defaults and reports its filtered total.
  for (const message of rows()) {
    expect(message.visibleTotal).toBeLessThanOrEqual(message.total);
    expect(message.rows.length).toBeLessThanOrEqual(50);
    for (const row of message.rows) {
      expect(row.filterEvidence.ownGain).toBeGreaterThanOrEqual(0);
      expect(row.filterEvidence.otherGain).toBeGreaterThanOrEqual(1);
    }
  }
  expect(result.id).toBe("1"); expect(result.context).toBe("ctx");
  expect(result.coverage.singles).toBeGreaterThan(0);
  expect(result.stats.scored).toBe(result.coverage.singles + result.coverage.extensions);
  // Filtering must use the retained search and reject messages for an obsolete context.
  port.onmessage!({ data: { type: "filter", id: "1", context: "obsolete", filters: defaultTradeFilters(), sort: "own", showHidden: true } });
  expect(rows()).toHaveLength(2);
  port.onmessage!({ data: { type: "filter", id: "1", context: "ctx", filters: defaultTradeFilters(), sort: "own", showHidden: true, limit: 1 } });
  expect(rows()[2].type).toBe("filtered");
  expect(rows()[2].total).toBe(result.total);
  expect(rows()[2].rows.length).toBeLessThanOrEqual(1);
  expect(rows()[2].counts).toBeDefined();
  const visibleBefore = rows()[2].visibleTotal;
  port.onmessage!({ data: { type: "sort", id: "1", context: "ctx", sort: "acceptance" } });
  expect(rows()[3].type).toBe("filtered");
  expect(rows()[3].visibleTotal).toBe(visibleBefore);
}, 30000);

// A running worker must respond to a filter before the extension phase completes.
it("filters streamed singles while larger packages are still being evaluated", async () => {
  const messages: any[] = [];
  const port: { postMessage: (message: any) => void; onmessage?: (event: any) => Promise<void> } = { postMessage: (message) => messages.push(message) };
  vi.stubGlobal("self", port);
  await import("../src/workers/trade-search.worker");
  const dataset = await tradeSearchFixture();
  const running = port.onmessage!({ data: { type: "start", id: "2", context: "ctx", dataset, settings: defaults,
    evidence: "", roleWeight: "0", useful: { protectedIds: [] },
    query: { teamA: "1", give: [], count: 1, below: 0, above: 0, lineupBasis: "best-available" } } });
  expect(messages.filter((message) => message.type !== "team").map((message) => message.type)).toEqual(["partial"]);
  await port.onmessage!({ data: { type: "filter", id: "2", context: "ctx", filters: defaultTradeFilters(), sort: "own", showHidden: false } });
  expect(messages.filter((message) => message.type !== "team").map((message) => message.type)).toEqual(["partial", "filtered"]);
  await running;
  expect(messages.at(-1).type).toBe("complete");
}, 30000);
