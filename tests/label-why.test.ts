import { describe, expect, it } from "vitest";
import {
  LABEL_TAGS,
  WHY_CLOSE_FRACTION,
  labelWhy,
  type LabelWhy,
} from "../src/domain/label-why";
import { labelWhyModel, regressionNear } from "./label-why-fixtures";

// Small helpers keep the assertions about domain-owned copy and statuses readable.
const byTag = (labels: LabelWhy[], tag: string) =>
  labels.find((label) => label.tag === tag);
const gates = (label: LabelWhy) =>
  label.groups.flatMap((group) => group.gates);
const gate = (label: LabelWhy, id: string) =>
  gates(label).find((item) => item.id === id);
const regressionBase = { highVolume: 30, meanRate: 0.1, rateSD: 0.05 };

describe("labelWhy earned labels", () => {
  it("renders every Gem classifier check, its source timestamp and notes", async () => {
    const { m } = await labelWhyModel();
    const gem = byTag(labelWhy(m.byId.get("1")!, m), "Gem")!;
    expect(gem.state).toBe("earned");
    expect(gem.chip).toBe("Gem");
    expect(gem.verdict).toBe("Gem: all 10 checks met");
    expect(gates(gem)).toHaveLength(10);
    expect(gates(gem).every((item) => item.status === "PASS")).toBe(true);
    expect(gem.groups.find((group) => group.id === "signal")!.total).toBe(8);
    expect(gem.details.sourceUTC).toBe(m.dataset.sourceUTC);
    expect(gem.details.notes.join(" ")).toContain("Provisional floor");
    expect(gem.details.notes.join(" ")).toContain(
      "Gem requires both actual scoring and workload",
    );
    expect(gem.stale).toBe(false);
    expect(gem.canAdjust).toBe(false);
    expect(gem.chart?.bars.map((bar) => bar.week)).toEqual([1, 2, 3, 4]);
    expect(gem.chart?.lines.map((line) => line.kind)).toEqual([
      "earlierAvg",
      "recentAvg",
      "threshold",
    ]);
    expect(
      gem.chart?.lines.find((line) => line.kind === "threshold")?.source,
    ).toBe("policy");
  });

  it("keeps the RB carries/targets caveat beside the points chart", async () => {
    const { m } = await labelWhyModel();
    const gem = byTag(labelWhy(m.byId.get("23")!, m), "Gem")!;
    expect(gem.details.notes[0]).toContain("Recent carries / game");
    expect(gem.chart?.unitLabel).toBe("Points per game");
    expect(gem.chart?.bars[0].value).toBe(16);
  });

  it("marks a warning label as flagged without changing its conditions", async () => {
    const { m } = await labelWhyModel();
    const sell = byTag(labelWhy(m.byId.get("9")!, m), "SELL HIGH")!;
    expect(sell.state).toBe("earned");
    expect(sell.tone).toBe("warning");
    expect(sell.verdict).toBe("SELL HIGH: flagged, all 3 conditions met");
    expect(gates(sell).every((item) => item.status === "PASS")).toBe(true);
    expect(sell.chart).toBeUndefined();
  });
});

describe("labelWhy near misses", () => {
  it("keeps one primary near miss and lets it outrank an earned primary", async () => {
    const { m } = await labelWhyModel();
    const labels = labelWhy(m.byId.get("21")!, m);
    const primaryNear = labels.filter(
      (label) =>
        label.state === "near" &&
        ["Gem", "Pre-gem", "Watch"].includes(label.tag),
    );
    expect(primaryNear).toHaveLength(1);
    expect(primaryNear[0].tag).toBe("Gem");
    expect(primaryNear[0].chip).toBe("Gem · 1 short");
    expect(primaryNear[0].summary).toBe(
      "Last 3 games: 16.00 PPG on 7.00 targets a game, but previous PPG is 2.00 short.",
    );
    expect(
      primaryNear[0].nearSections?.find((section) => section.id === "not-met")
        ?.gates.map((item) => item.id),
    ).toEqual(["gem.previous-ppg"]);
    expect(byTag(labels, "Pre-gem")?.state).toBe("earned");
    // A non-sample Gem miss has no average formula to flip.
    expect(primaryNear[0].flip).toBeUndefined();
  });

  it("shows a Gem near miss for a Watch player but no lower primary", async () => {
    const { m } = await labelWhyModel();
    const labels = labelWhy(m.byId.get("26")!, m);
    expect(byTag(labels, "Watch")?.state).toBe("earned");
    expect(byTag(labels, "Gem")?.state).toBe("near");
    expect(byTag(labels, "Gem")?.chip).toBe("Gem · 1 short");
    expect(labels.some((label) => label.tag === "Pre-gem")).toBe(false);
  });

  it("shows no lower primary near miss for a Gem player", async () => {
    const { m } = await labelWhyModel();
    const labels = labelWhy(m.byId.get("1")!, m);
    expect(labels.some((label) => label.tag === "Pre-gem")).toBe(false);
    expect(labels.some((label) => label.tag === "Watch")).toBe(false);
  });

  it("uses a tailored sentence for a Pre-gem miss without a Not yet prefix", async () => {
    const { m } = await labelWhyModel();
    const pre = byTag(labelWhy(m.byId.get("19")!, m), "Pre-gem")!;
    expect(pre.state).toBe("near");
    expect(pre.chip).toBe("Pre-gem · 1 short");
    expect(pre.summary).toContain("but recent PPG is 2.00 short");
    expect(pre.summary).not.toContain("Not yet");
    expect(pre.flip).toBeUndefined();
  });

  it("builds a Watch flip hint and a policy threshold", async () => {
    const { m } = await labelWhyModel();
    const watch = byTag(labelWhy(m.byId.get("14")!, m), "Watch")!;
    expect(watch.chip).toBe("Watch · 1 short");
    expect(watch.summary).toBe(
      "Targets are 5.00 a game in the early sample, but recent targets are 1.00 short.",
    );
    expect(watch.flip).toEqual({
      headline:
        "About 1.00 more targets a game over the last 3 games (≈ 3.00 in total)",
      detail: "The numbers so far already meet the other checks.",
      caveat:
        "Based on the current 3-game window. The next game changes the window, so treat this as a rough guide.",
    });
    expect(
      watch.chart?.lines.find((line) => line.kind === "threshold")?.source,
    ).toBe("policy");
    expect(watch.chart?.note).toBeUndefined();
    expect(watch.canAdjust).toBe(false);
  });

  it("marks editable Role-growth thresholds and renders the jump bracket", async () => {
    const { m } = await labelWhyModel();
    const role = byTag(labelWhy(m.byId.get("22")!, m), "Role-growth watch")!;
    expect(role.chip).toBe("Role-growth · 1 short");
    expect(role.flip?.headline).toBe(
      "About 1.00 more targets a game over the last 3 games (≈ 3.00 in total)",
    );
    expect(role.chart?.note).toBe("Purple thresholds are your settings.");
    expect(
      role.chart?.lines.find((line) => line.kind === "threshold")?.source,
    ).toBe("setting");
    expect(role.chart?.jump?.label).toBe("+2.00");
    expect(role.chart?.bars.map((bar) => bar.window)).toEqual([
      "earlier",
      "earlier",
      "recent",
      "recent",
      "recent",
    ]);
    expect(role.canAdjust).toBe(true);
  });

  it("adds the ESPN alternative when only the projection gate fails", async () => {
    const { m } = await labelWhyModel();
    const scoring = byTag(
      labelWhy(m.byId.get("16")!, m),
      "Scoring breakout watch",
    )!;
    expect(scoring.chip).toBe("Scoring breakout · 1 short");
    expect(scoring.flip?.detail).toContain(
      "It also flips if ESPN lowers the season projection to 12.00 or less.",
    );
    expect(scoring.chart?.note).toBe(
      "Blue is ESPN's number, so it can move when ESPN updates.",
    );
    expect(
      scoring.chart?.lines.find((line) => line.kind === "espn")?.source,
    ).toBe("espn");
    expect(scoring.canAdjust).toBe(true);
  });

  it("uses percentage points in the Projection-gap sentence", async () => {
    const { m } = await labelWhyModel();
    const projection = byTag(
      labelWhy(m.byId.get("17")!, m),
      "Projection-gap watch",
    )!;
    expect(projection.chip).toBe("Projection-gap · 1 short");
    expect(projection.summary).toBe(
      "20.00 PPG this season vs. ESPN's 17.00; last 3 games: 20.00, but the relative gap is 2 percentage points short.",
    );
    expect(projection.flip?.headline).toBe(
      "About 0.40 more PPG on the season (≈ 2.00 points)",
    );
    expect(projection.chart?.lines.map((line) => line.kind)).toEqual([
      "seasonAvg",
      "recentAvg",
      "espn",
    ]);
    expect(projection.chart?.note).toBe(
      "Blue is ESPN's number, so it can move when ESPN updates.",
    );
    expect(gate(projection, "projection.gap-share")?.margin.text).toBe(
      "2% short",
    );
  });

  it("offers a sample-size flip when the only miss is a game count", async () => {
    const { m } = await labelWhyModel();
    const projection = byTag(
      labelWhy(m.byId.get("13")!, m),
      "Projection-gap watch",
    )!;
    expect(projection.failed).toBe(1);
    expect(projection.flip?.headline).toBe("Needs 1 more played game");
    expect(projection.flip?.detail).toBe("Needs 1 more played game");
    expect(
      projection.nearSections?.find((section) => section.id === "not-met")
        ?.gates.map((item) => item.id),
    ).toEqual(["projection.games"]);
  });
});

describe("labelWhy regression near misses", () => {
  it("uses the compact trigger pill and long-form percentage sentence", async () => {
    const { m } = await labelWhyModel();
    const sell = byTag(
      labelWhy(
        regressionNear(m, {
          ...regressionBase,
          id: "near-sell",
          opportunities: 20,
          tdRate: 0.17,
          games: 5,
        }),
        m,
      ),
      "SELL HIGH",
    )!;
    expect(sell.state).toBe("near");
    expect(sell.chip).toBe("SELL HIGH · almost");
    expect(sell.verdict).toBe("SELL HIGH: not flagged, 1 condition away");
    expect(sell.chart).toBeUndefined();
    expect(gate(sell, "regression.td-rate")?.margin.text).toBe(
      "1% short of the trigger",
    );
    expect(sell.summary).toContain("1 percentage point short of the trigger");
  });

  it("shows a BUY LOW near miss with a percentage-point sentence", async () => {
    const { m } = await labelWhyModel();
    const buy = byTag(
      labelWhy(
        regressionNear(m, {
          ...regressionBase,
          id: "near-buy",
          opportunities: 35,
          tdRate: 0.08,
          games: 5,
        }),
        m,
      ),
      "BUY LOW",
    )!;
    expect(buy.chip).toBe("BUY LOW · 1 short");
    expect(buy.summary).toContain("1 percentage point short of the trigger");
    expect(gate(buy, "regression.td-rate")?.margin.text).toBe("<1% short");
  });

  it("dedupes TD caution behind SELL HIGH when the failing ids match", async () => {
    const { m } = await labelWhyModel();
    const labels = labelWhy(
      regressionNear(m, {
        ...regressionBase,
        id: "near-sell",
        opportunities: 20,
        tdRate: 0.17,
        games: 5,
      }),
      m,
    );
    expect(labels.some((label) => label.tag === "SELL HIGH")).toBe(true);
    expect(labels.some((label) => label.tag === "TD caution")).toBe(false);
  });

  it("never shows the opposite regression label beside an earned one", async () => {
    const { m } = await labelWhyModel();
    const sell = labelWhy(
      regressionNear(m, {
        ...regressionBase,
        id: "earned-sell",
        opportunities: 20,
        tdRate: 0.2,
        games: 5,
        regression: "SELL HIGH",
      }),
      m,
    );
    expect(byTag(sell, "SELL HIGH")?.state).toBe("earned");
    expect(sell.some((label) => label.tag === "BUY LOW")).toBe(false);
    expect(sell.some((label) => label.tag === "TD caution")).toBe(false);

    const buy = labelWhy(
      regressionNear(m, {
        ...regressionBase,
        id: "earned-buy",
        opportunities: 35,
        tdRate: 0.05,
        games: 5,
        regression: "BUY LOW",
      }),
      m,
    );
    expect(byTag(buy, "BUY LOW")?.state).toBe("earned");
    expect(buy.some((label) => label.tag === "SELL HIGH")).toBe(false);
    expect(buy.some((label) => label.tag === "TD caution")).toBe(false);
  });
});

describe("labelWhy chart, cap and metadata", () => {
  it("leaves missing workload bars null instead of charting zero", async () => {
    const { m } = await labelWhyModel();
    const p = m.byId.get("22")!;
    const weekFive = m.dataset.tables.ModelHistory.find(
      (row) => row.PlayerID === 22 && row.Week === 5,
    )!;
    delete weekFive.Targets;
    const watch = byTag(labelWhy(p, m), "Watch")!;
    expect(watch.chart?.bars.find((bar) => bar.week === 5)?.value).toBeNull();
    expect(watch.chart?.bars.some((bar) => bar.value === 0)).toBe(false);
  });

  it("keeps older Gem bars unused while recent bars stay active", async () => {
    const { m } = await labelWhyModel();
    const gem = byTag(labelWhy(m.byId.get("25")!, m), "Gem")!;
    expect(gem.chart?.bars.map((bar) => bar.window)).toEqual([
      "unused",
      "earlier",
      "recent",
      "recent",
      "recent",
    ]);
  });

  it("uses the preceding window for Reduced workload bars", async () => {
    const { m } = await labelWhyModel();
    const reduced = byTag(
      labelWhy(m.byId.get("24")!, m),
      "Reduced workload",
    )!;
    expect(reduced.chart?.bars.map((bar) => bar.window)).toEqual([
      "earlier",
      "earlier",
      "earlier",
      "recent",
      "recent",
      "recent",
    ]);
  });

  it("caps the chip row and never drops earned labels", async () => {
    const { m } = await labelWhyModel();
    for (const p of m.players) {
      const labels = labelWhy(p, m);
      expect(labels.length).toBeLessThanOrEqual(6);
      expect(new Set(labels.map((label) => label.tag)).size).toBe(
        labels.length,
      );
      const firstNear = labels.findIndex((label) => label.state === "near");
      if (firstNear >= 0)
        expect(labels.slice(firstNear).every((label) => label.state === "near")).toBe(
          true,
        );
    }
  });

  it("keeps the sample-only near row at six chips for the no-earned fixture", async () => {
    const { m } = await labelWhyModel();
    const labels = labelWhy(m.byId.get("15")!, m);
    expect(labels).toHaveLength(6);
    expect(labels.every((label) => label.state === "near")).toBe(true);
  });

  it("keeps historical context short and gate-specific", async () => {
    const { m } = await labelWhyModel();
    const gem = byTag(labelWhy(m.byId.get("1")!, m), "Gem")!;
    expect(gate(gem, "gem.recent-workload")?.historical?.short).toContain(
      "a typical starting WR gets about",
    );
    expect(gate(gem, "gem.recent-workload")?.historical?.note).toBeTruthy();
  });

  it("marks stale snapshots without hiding the source timestamp", async () => {
    const { m } = await labelWhyModel();
    const stale = {
      ...m,
      dataset: { ...m.dataset, sourceUTC: "2020-01-01T00:00:00.000Z" },
    };
    const gem = byTag(labelWhy(m.byId.get("1")!, stale), "Gem")!;
    expect(gem.stale).toBe(true);
    expect(gem.details.sourceUTC).toBe("2020-01-01T00:00:00.000Z");
  });

  it("exports the close threshold and uses the expected margin copy", async () => {
    const { m } = await labelWhyModel();
    expect(WHY_CLOSE_FRACTION).toBe(0.25);
    const gem = byTag(labelWhy(m.byId.get("1")!, m), "Gem")!;
    expect(gate(gem, "gem.recent-scoring-support")?.margin.text).toBe(
      "+1 spare",
    );
    expect(gate(gem, "gem.recent-ppg")?.margin.text).toBe("Right at the line");
    const projection = byTag(
      labelWhy(m.byId.get("1")!, m),
      "Projection-gap watch",
    )!;
    expect(gate(projection, "projection.gap")?.margin.text).toBe(
      "2.0× the bar",
    );
  });

  it("lists every in-scope label in the registry", () => {
    expect(LABEL_TAGS).toEqual([
      "Gem",
      "Pre-gem",
      "Watch",
      "Role-growth watch",
      "Scoring breakout watch",
      "Projection-gap watch",
      "SELL HIGH",
      "TD caution",
      "BUY LOW",
      "Reduced workload",
    ]);
  });
});
