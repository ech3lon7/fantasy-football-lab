import { describe, expect, it } from "vitest";
import {
  LABEL_TAGS,
  labelWhy,
  type LabelWhy,
} from "../src/domain/label-why";
import { playedHistory } from "../src/domain/opportunity";
import { playerSignals, type Player } from "../src/domain/valuation";
import { labelWhyModel } from "./label-why-fixtures";

const gates = (label: LabelWhy) =>
  label.groups.flatMap((group) => group.gates);
const active = (p: Player) =>
  new Set<string>([...playerSignals(p), p.regression]);

// These invariants keep presentation states tied to the classifiers that assign labels.
describe("labelWhy consistency", () => {
  it("matches classifier-earned labels and keeps every gate honest", async () => {
    const { m } = await labelWhyModel();
    for (const p of m.players) {
      const labels = labelWhy(p, m);
      const activeTags = active(p);
      for (const label of labels) {
        expect(LABEL_TAGS).toContain(label.tag);
        expect(label.state === "earned").toBe(activeTags.has(label.tag));
        expect(label.failed).toBe(
          gates(label).filter((gate) => gate.status === "FAIL").length,
        );
        expect(label.shortfall).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(label.shortfall)).toBe(true);
        expect(label.summary.length).toBeGreaterThan(0);
        expect(label.details.sourceUTC).toBe(m.dataset.sourceUTC);
        expect(label.canAdjust).toBe(
          gates(label).some((gate) => gate.thresholdSource === "setting"),
        );
        // Earned means the classifier says so; every displayed gate must agree.
        if (label.state === "earned") {
          expect(
            gates(label).filter((gate) => gate.status !== "PASS"),
          ).toEqual([]);
          expect(label.flip).toBeUndefined();
          expect(label.nearSections).toBeUndefined();
          expect(label.chip).toBe(label.tag);
        } else {
          const failed = gates(label).filter(
            (gate) => gate.status === "FAIL",
          );
          const unknown = gates(label).filter(
            (gate) => gate.status === "UNKNOWN",
          );
          expect(failed.length).toBeGreaterThanOrEqual(1);
          expect(failed.length).toBeLessThanOrEqual(2);
          expect(unknown).toEqual([]);
          expect(
            gates(label).filter(
              (gate) =>
                gate.group === "trust" &&
                gate.kind === "condition" &&
                gate.status !== "PASS",
            ),
          ).toEqual([]);
          expect(label.closest).toBeUndefined();
          expect(label.summary).not.toContain("Not yet");
          // Near sections partition every gate without overlap.
          const notMet = label.nearSections!.find(
            (section) => section.id === "not-met",
          )!;
          const alreadyMet = label.nearSections!.find(
            (section) => section.id === "already-met",
          )!;
          expect(notMet.count).toBe(failed.length);
          expect(alreadyMet.count).toBe(
            gates(label).length - failed.length,
          );
          expect(
            new Set([
              ...notMet.gates.map((gate) => gate.id),
              ...alreadyMet.gates.map((gate) => gate.id),
            ]).size,
          ).toBe(gates(label).length);
          if (label.tone === "warning") {
            expect(label.chip.endsWith("· almost")).toBe(true);
          } else {
            expect(label.chip.endsWith(`· ${failed.length} short`)).toBe(true);
          }
        }
        // Warnings stay on the two labels whose classifier emits them.
        if (!["Gem", "Watch"].includes(label.tag))
          expect(label.warnings).toEqual([]);
        if (label.tag !== "Gem") expect(label.details.notes).toEqual([]);
        // Charts cover every played game and never invent a zero for a gap.
        if (
          ["BUY LOW", "SELL HIGH", "TD caution"].includes(label.tag)
        ) {
          expect(label.chart).toBeUndefined();
        } else {
          const played =
            playedHistory(m.dataset).get(p.id)?.length ?? 0;
          expect(label.chart?.bars).toHaveLength(played);
          for (const bar of label.chart!.bars)
            expect(
              bar.value === null || Number.isFinite(bar.value),
            ).toBe(true);
          for (const line of label.chart!.lines)
            expect(Number.isFinite(line.value)).toBe(true);
        }
      }
      // Earned labels are never dropped by the cap or dedupe.
      for (const tag of LABEL_TAGS) {
        if (activeTags.has(tag))
          expect(
            labels.some(
              (label) => label.tag === tag && label.state === "earned",
            ),
          ).toBe(true);
      }
    }
  });

  it("never creates a near miss in workbook mode", async () => {
    const { m } = await labelWhyModel();
    const workbook = { ...m, analysisVersion: "v5.2-workbook" };
    for (const p of m.players) {
      const labels = labelWhy(p, workbook);
      expect(labels.every((label) => label.state === "earned")).toBe(true);
    }
  });

  it("hides near misses when a trust condition or model value is missing", async () => {
    const { m } = await labelWhyModel();
    const incomplete = m.byId.get("27")!;
    expect(labelWhy(incomplete, m)).toEqual([]);
    expect(labelWhy({ ...incomplete, value: null }, m)).toEqual([]);
  });

  it("treats a sample-size-only miss as a valid near miss", async () => {
    const { m } = await labelWhyModel();
    const projection = labelWhy(m.byId.get("13")!, m).find(
      (label) => label.tag === "Projection-gap watch",
    )!;
    expect(projection.state).toBe("near");
    expect(projection.failed).toBe(1);
    expect(
      gates(projection).filter((gate) => gate.status === "FAIL").map((gate) => gate.id),
    ).toEqual(["projection.games"]);
    expect(projection.flip?.headline).toBe("Needs 1 more played game");
  });

  it("gives non-sample Gem and warning misses no flip card", async () => {
    const { m } = await labelWhyModel();
    const gem = labelWhy(m.byId.get("21")!, m).find(
      (label) => label.tag === "Gem",
    )!;
    expect(gem.state).toBe("near");
    expect(gem.flip).toBeUndefined();
    const buy = labelWhy(m.byId.get("7")!, m).find(
      (label) => label.tag === "BUY LOW",
    )!;
    expect(buy.state).toBe("near");
    expect(buy.flip).toBeUndefined();
  });
});
