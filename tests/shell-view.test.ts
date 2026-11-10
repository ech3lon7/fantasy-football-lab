import { describe, expect, it } from "vitest";
import {
  pageForRoute,
  searchPlayers,
  sectionForRoute,
  sections,
  sourceFreshness,
} from "../src/domain/view/shell";
import type { Model } from "../src/domain/valuation";

// A minimal model is enough because search reads only name, id, position, team and expected PPG.
const model = {
  players: [
    { id: "3", name: "Isaiah Crane", pos: "WR", nfl: "MIA", expected: 17.5 },
    { id: "1", name: "Marcus Crane", pos: "RB", nfl: "DAL", expected: null },
    { id: "2", name: "Cranberry Lee", pos: "TE", nfl: "KC", expected: 7.8 },
    { id: "4", name: "Owen Baptiste", pos: "TE", nfl: "GB", expected: 6.1 },
  ],
} as unknown as Model;

describe("sections and routes", () => {
  it("covers every old route with one section and keeps player links under Scouting", () => {
    for (const [route, id] of [
      ["overview", "week"],
      ["teams", "league"],
      ["players", "scouting"],
      ["gems", "scouting"],
      ["weekly", "scouting"],
      ["player/12", "scouting"],
      ["trades", "trade"],
      ["journal", "trade"],
      ["model", "lab"],
      ["data", "lab"],
    ] as const)
      expect(sectionForRoute(route)).toBe(id);
    expect(sectionForRoute("unknown")).toBeNull();
  });
  it("maps each new section route to a screen that exists today", () => {
    for (const s of sections) expect(pageForRoute(s.id)).toBe(s.page);
    expect(pageForRoute("player/12")).toBe("overview");
    expect(pageForRoute("gems")).toBe("gems");
  });
});

describe("player search", () => {
  it("returns nothing for an empty query", () => {
    expect(searchPlayers(model, "  ")).toEqual([]);
  });
  it("ranks prefix, then word-start, then other matches, and keeps null EPPG null", () => {
    const hits = searchPlayers(model, "cran");
    expect(hits.map((h) => h.name)).toEqual([
      "Cranberry Lee",
      "Isaiah Crane",
      "Marcus Crane",
    ]);
    expect(hits[2].eppg).toBeNull();
  });
  it("honors the result limit", () => {
    expect(searchPlayers(model, "a", 2)).toHaveLength(2);
  });
});

describe("source freshness", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("reports minutes, hours and days and flags only over 24 hours", () => {
    expect(sourceFreshness("2026-11-10T11:30:00Z", now)).toEqual({
      label: "Source 30m ago",
      stale: false,
    });
    expect(sourceFreshness("2026-11-10T10:00:00Z", now).label).toBe(
      "Source 2h ago",
    );
    expect(sourceFreshness("2026-11-10T12:00:00Z", now).stale).toBe(false);
    const old = sourceFreshness("2026-11-08T11:00:00Z", now);
    expect(old).toEqual({ label: "Source 2d ago", stale: true });
  });
  it("treats a missing or invalid time as stale and unavailable", () => {
    for (const v of [null, undefined, "not a date"])
      expect(sourceFreshness(v, now)).toEqual({
        label: "Source time unavailable",
        stale: true,
      });
  });
});
