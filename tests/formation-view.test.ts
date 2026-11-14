import { describe, expect, it } from "vitest";
import { evaluate } from "../src/domain/valuation";
import { roster, teamsAssessment } from "../src/domain/lineups";
import { cmpId } from "../src/domain/contracts";
import { readStarterLineup, starterTemplate } from "../src/domain/starter-lineups";
import type { FormationSlot } from "../src/domain/lineup-optimizer";
import {
  backupLastName,
  formationLineup,
  formationTone,
  formationView,
  mppgBadge,
  shortName,
} from "../src/domain/view/formation";
import { formationFixture } from "./fixtures";

async function setup() {
  const d = await formationFixture();
  const m = evaluate(d, d.settings);
  const team = "1";
  const grades = teamsAssessment(m).get(team)!;
  const { lineup, source } = formationLineup(m, team);
  return { m, team, grades, lineup, source };
}

describe("formation view: cards", () => {
  it("draws nine cards in formation order with the E10.1 grid positions", async () => {
    const { m, team, grades, lineup, source } = await setup();
    const view = formationView(m, team, grades, lineup, source);
    expect(view.cards).toHaveLength(9);
    expect(view.cards.map((card) => card.label)).toEqual([
      "WR1",
      "QB",
      "TE",
      "WR2",
      "RB1",
      "RB2",
      "FLEX",
      "K",
      "D/ST",
    ]);
    expect(view.cards.map((card) => [card.row, card.column])).toEqual([
      [1, 1],
      [1, 4],
      [1, 5],
      [1, 7],
      [2, 3],
      [2, 4],
      [2, 5],
      [2, 6],
      [2, 7],
    ]);
    expect(view.source).toBe("Your ESPN lineup");
    expect(view.total).toBe(120.4);
    expect(view.spread).toBeGreaterThan(0);
  });

  it("gives every card exactly two backup rows", async () => {
    const { m, team, grades, lineup, source } = await setup();
    const view = formationView(m, team, grades, lineup, source);
    for (const card of view.cards) expect(card.backups).toHaveLength(2);
    const qb = view.cards.find((card) => card.label === "QB")!;
    expect(qb.backups.map((b) => b.playerId)).toEqual(["15", "21"]);
    // A bench player may repeat across slots: Dunn covers both RB cards and FLEX.
    const copies = view.cards.flatMap((card) =>
      card.backups.filter((b) => b.playerId === "10" && !b.empty).map(() => card.label),
    );
    expect(copies.sort()).toEqual(["FLEX", "RB1", "RB2"]);
    for (const card of view.cards.filter((c) => c.label === "FLEX"))
      for (const backup of card.backups)
        if (!backup.empty)
          expect(["RB", "WR", "TE"]).toContain(backup.pos);
  });

  it("keeps an empty slot grey with two backup rows", async () => {
    const { m, team, grades, lineup, source } = await setup();
    const empty: FormationSlot[] = lineup.map((slot) =>
      slot.slot === "TE" ? { ...slot, playerId: null } : slot,
    );
    const view = formationView(m, team, grades, empty, source);
    const te = view.cards.find((card) => card.label === "TE")!;
    expect(te.fullName).toBe("Empty");
    expect(te.mppgText).toBe("—");
    expect(te.tone).toBe("out");
    expect(te.backups.every((backup) => !backup.empty)).toBe(true);
  });
});

describe("formation view: tone and badge", () => {
  const mppg = { value: 12.5, reason: "" };
  it("maps every matchup tone, including unavailable and bye", () => {
    expect(formationTone({ tone: "soft", bye: false }, mppg)).toBe("good");
    expect(formationTone({ tone: "tough", bye: false }, mppg)).toBe("bad");
    expect(formationTone({ tone: "neutral", bye: false }, mppg)).toBe(
      "neutral",
    );
    expect(formationTone({ tone: "neutral", bye: false, status: "unavailable" }, mppg)).toBe(
      "neutral",
    );
    expect(formationTone({ tone: "neutral", bye: true }, mppg)).toBe("out");
    expect(
      formationTone({ tone: "soft", bye: false }, { value: null, reason: "Out" }),
    ).toBe("out");
    // An unavailable matchup or projection is neutral; only a bye or confirmed absence is grey.
    expect(formationTone(null, mppg)).toBe("neutral");
    expect(formationTone({ tone: "soft", bye: false }, { value: null, reason: "No ESPN weekly projection" })).toBe("neutral");
  });

  it("shows BYE, OUT or a dash for null MPPG and never zero", () => {
    expect(mppgBadge({ value: 21.6, reason: "" })).toBe("21.6");
    expect(mppgBadge({ value: 0, reason: "" })).toBe("0.0");
    expect(mppgBadge({ value: null, reason: "Bye week" })).toBe("BYE");
    expect(mppgBadge({ value: null, reason: "Out" })).toBe("OUT");
    expect(mppgBadge({ value: null, reason: "No ESPN weekly projection" })).toBe(
      "—",
    );
  });

  it("reads matchup tone from the fixture and keeps a bye separate", async () => {
    const d = await formationFixture({ byeStarter: true });
    const m = evaluate(d, d.settings);
    const grades = teamsAssessment(m).get("1")!;
    const { lineup, source } = formationLineup(m, "1");
    const view = formationView(m, "1", grades, lineup, source);
    expect(view.cards.find((c) => c.label === "QB")!.tone).toBe("good");
    // The starters are ordered by expected value, so the tough-matchup back is RB1.
    expect(view.cards.find((c) => c.label === "RB1")!.tone).toBe("bad");
    expect(view.cards.find((c) => c.label === "RB2")!.tone).toBe("good");
    const te = view.cards.find((c) => c.label === "TE")!;
    expect(te.tone).toBe("out");
    expect(te.mppgText).toBe("BYE");
    expect(te.matchupLine).toBe("Bye week");
    for (const card of view.cards)
      if (card.matchupLine)
        expect(card.matchupLine).toMatch(
          /(good matchup|neutral|bad matchup|Bye week|out)$/,
        );
  });
});

describe("formation view: names", () => {
  it("shows a player's surname instead of a generational suffix on narrow screens", () => {
    expect(backupLastName({ name: "Luther Burden III", pos: "WR" })).toBe("BURDEN");
  });
  it("uses condensed short names and the full accessible name", async () => {
    const { m, team, grades, lineup, source } = await setup();
    expect(shortName({ name: "Jalen Mercer", pos: "QB" })).toBe("J.MERCER");
    expect(shortName({ name: "Summit Hawks", pos: "D/ST" })).toBe(
      "SUMMIT HAWKS",
    );
    const view = formationView(m, team, grades, lineup, source);
    const qb = view.cards.find((card) => card.label === "QB")!;
    expect(qb.shortName).toBe("J.MERCER");
    expect(qb.accessibleName).toBe(
      "Jalen Mercer, QB, MPPG 32.4, vs SOFT · good matchup",
    );
    const flex = view.cards.find((card) => card.label === "FLEX")!;
    expect(flex.flexPos).toBe("WR");
  });

  it("labels the saved app lineup by its source", async () => {
    const d = await formationFixture();
    const m = evaluate(d, d.settings);
    const template = starterTemplate(m, readStarterLineup(m, "1").ids);
    const ids = [...template.ids];
    // Mark the bench RB as a starter and bench the FLEX WR, then save that lineup.
    const saved = JSON.stringify({
      version: 1,
      teams: {
        1: {
          season: 2026,
          teamName: "Test A",
          week: m.current,
          savedUTC: new Date().toISOString(),
          starters: [...ids.filter((id) => id && id !== "7"), "10"].sort(),
          roster: roster(m, "1").sort(cmpId),
        },
      },
    });
    const result = formationLineup(m, "1", saved);
    expect(result.source).toBe("Your saved lineup");
    expect(result.errors).toEqual([]);
  });
});
