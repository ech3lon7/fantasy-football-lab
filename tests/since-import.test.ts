import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import {
  importDigest,
  importSummarySchema,
  summarizeImport,
  type ImportSummary,
} from "../src/domain/view/since-import";
import { fixture } from "./fixtures";

const summary = (
  players: ImportSummary["players"],
  sourceUTC: string | null = "2026-11-03T12:00:00Z",
): ImportSummary => ({
  version: 1,
  sourceUTC,
  summarizedAt: "2026-11-03T12:05:00Z",
  players,
});
const p = (name: string, labels: string[], eppg: number | null) => ({
  name,
  labels,
  eppg,
});

describe("import summary", () => {
  it("is small, valid and keeps unavailable EPPG as null", async () => {
    const d = await fixture([12, 18, 24]);
    const m = evaluate(d, d.settings);
    const s = summarizeImport(m);
    expect(importSummarySchema.safeParse(s).success).toBe(true);
    expect(Object.keys(s.players)).toHaveLength(m.players.length);
    for (const entry of Object.values(s.players))
      expect(entry.eppg === null || Number.isFinite(entry.eppg)).toBe(true);
    // It holds names, labels and EPPG only, not the workbook.
    expect(Object.keys(Object.values(s.players)[0]).sort()).toEqual([
      "eppg",
      "labels",
      "name",
    ]);
  });
  it("rejects a malformed or future-version summary", () => {
    expect(importSummarySchema.safeParse({ version: 2 }).success).toBe(false);
    expect(importSummarySchema.safeParse(null).success).toBe(false);
  });
});

describe("digest", () => {
  const before = summary({
    "1": p("Rico Vance", ["Watch"], 9.5),
    "2": p("Nico Ferreira", [], 8.3),
    "3": p("Sam Whitaker", ["Gem"], 12),
    "4": p("Missing Mike", [], null),
  });
  const now = summary(
    {
      "1": p("Rico Vance", ["Watch", "Role-growth watch"], 10.0),
      "2": p("Nico Ferreira", ["Scoring breakout watch"], 8.9),
      "3": p("Sam Whitaker", [], 12.01),
      "4": p("Missing Mike", [], 7),
      "5": p("Brand New", ["Gem"], 11),
    },
    "2026-11-10T12:00:00Z",
  );
  const digest = importDigest(before, now)!;
  it("lists labels gained and lost and the largest Expected PPG movers", () => {
    const labels = digest.items.filter((i) => i.kind !== "eppg-mover");
    expect(labels.map((i) => `${i.kind}:${i.name}:${i.label}`)).toEqual([
      "new-label:Nico Ferreira:Scoring breakout watch",
      "new-label:Rico Vance:Role-growth watch",
      "lost-label:Sam Whitaker:Gem",
    ]);
    const movers = digest.items.filter((i) => i.kind === "eppg-mover");
    expect(movers.map((i) => i.name)).toEqual(["Nico Ferreira", "Rico Vance"]);
    expect(movers[0].delta).toBeCloseTo(0.6, 9);
    expect(movers[0]).toMatchObject({ from: 8.3, to: 8.9 });
  });
  it("ignores players who are new, tiny changes, and a missing EPPG on either side", () => {
    const names = digest.items.map((i) => i.name);
    expect(names).not.toContain("Brand New");
    expect(names).not.toContain("Missing Mike");
    // Sam moved 0.01, below the threshold; only his lost label is listed.
    expect(digest.items.filter((i) => i.name === "Sam Whitaker")).toHaveLength(
      1,
    );
  });
  it("says which import it compared against", () => {
    expect(digest.comparedTo).toBe("2026-11-03T12:00:00Z");
  });
  it("returns null with no previous import or nothing to report, so the section is hidden", () => {
    expect(importDigest(null, now)).toBeNull();
    expect(importDigest(before, before)).toBeNull();
  });
  it("caps labels and movers", () => {
    const many = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        String(i),
        p(`P${String(i).padStart(2, "0")}`, [], i),
      ]),
    );
    const moved = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [
        String(i),
        p(`P${String(i).padStart(2, "0")}`, ["Gem"], i + 2),
      ]),
    );
    const d = importDigest(summary(many), summary(moved), {
      labels: 3,
      movers: 2,
    })!;
    expect(d.items.filter((i) => i.kind === "new-label")).toHaveLength(3);
    expect(d.items.filter((i) => i.kind === "eppg-mover")).toHaveLength(2);
  });
});
