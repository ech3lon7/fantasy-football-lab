import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChainGradeLimitControls,
  ChainRequirementChips,
} from "../src/features/ChainLegControls";
import { PositionGradeChips } from "../src/features/TradeWorkspace";
import type { ChainStep } from "../src/domain/trade-chains";
import type {
  ChainPositionImpact,
  PositionalGradeImpactRule,
} from "../src/domain/chain-position-impact";

describe("UI Integration: Positional Grade Impact in ChainLegControls", () => {
  it("renders PositionalGradeImpactControls inside ChainGradeLimitControls", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "WR", steps: 2 },
    ];
    const value: ChainStep = {
      offer: { minimum: 1, maximum: 2 },
      receive: { minimum: 1, maximum: 2 },
      gradeImpacts: rules,
    };
    const change = vi.fn();

    const html = renderToStaticMarkup(
      React.createElement(ChainGradeLimitControls, {
        label: "First trade",
        value,
        change,
      })
    );

    // Should render the grade impact container from PositionalGradeImpactControls
    expect(html).toContain("grade-impact-container");
    expect(html).toContain("Positional Grade Goals");
    // Should have aria-label prefix with the leg label
    expect(html).toContain('aria-label="First trade grade goal 1 team"');
    expect(html).toContain('aria-label="First trade grade goal 1 position"');
    expect(html).toContain('aria-label="First trade grade goal 1 target"');
  });

  it("threads custom positions into PositionalGradeImpactControls inside ChainGradeLimitControls", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "WR", steps: 2 },
    ];
    const value: ChainStep = {
      offer: { minimum: 1, maximum: 2 },
      receive: { minimum: 1, maximum: 2 },
      gradeImpacts: rules,
    };
    const change = vi.fn();

    const html = renderToStaticMarkup(
      React.createElement(ChainGradeLimitControls, {
        label: "First trade",
        value,
        change,
        positions: ["RB", "WR", "TE"],
      })
    );

    expect(html).toContain('value="RB"');
    expect(html).toContain('value="WR"');
    expect(html).toContain('value="TE"');
    expect(html).not.toContain('value="QB"');
  });

  it("renders clear chip in ChainRequirementChips when value.gradeImpacts has rules", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "WR", steps: 2 },
      { id: "r2", side: "other", position: "RB", steps: -1 },
    ];
    const value: ChainStep = {
      offer: { minimum: 1, maximum: 2 },
      receive: { minimum: 1, maximum: 2 },
      gradeImpacts: rules,
    };
    const change = vi.fn();
    const mockModel: any = { byId: new Map() };

    const html = renderToStaticMarkup(
      React.createElement(ChainRequirementChips, {
        m: mockModel,
        label: "First trade",
        value,
        change,
      })
    );

    // Should display a chip indicating the active grade goals
    expect(html).toContain("First trade: 2 grade goals");
    expect(html).toContain('aria-label="Clear First trade grade goals"');
  });

  it("does not render grade impact chip in ChainRequirementChips when gradeImpacts is empty", () => {
    const value: ChainStep = {
      offer: { minimum: 1, maximum: 2 },
      receive: { minimum: 1, maximum: 2 },
    };
    const change = vi.fn();
    const mockModel: any = { byId: new Map() };

    const html = renderToStaticMarkup(
      React.createElement(ChainRequirementChips, {
        m: mockModel,
        label: "First trade",
        value,
        change,
      })
    );

    expect(html).not.toContain("grade goal");
  });
});

describe("UI Integration: PositionGradeChips in TradeWorkspace", () => {
  it("renders good, bad, and neutral chips for positional grade transitions", () => {
    const impact: ChainPositionImpact = {
      own: [
        {
          position: "WR",
          before: "C",
          after: "B",
          drop: 0,
          stepDelta: 2,
        },
        {
          position: "RB",
          before: "B",
          after: "C",
          drop: 2,
          stepDelta: -2,
        },
        {
          position: "QB",
          before: "B+",
          after: "B+",
          drop: 0,
          stepDelta: 0,
        },
      ],
      other: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(PositionGradeChips, {
        impact,
      })
    );

    // Container
    expect(html).toContain("trade-position-chips");

    // Upgrade chip (.position-grade-chip.good)
    expect(html).toMatch(/position-grade-chip\s+good/);
    expect(html).toContain("WR");
    expect(html).toContain("C → B");

    // Downgrade chip (.position-grade-chip.bad)
    expect(html).toMatch(/position-grade-chip\s+bad/);
    expect(html).toContain("RB");
    expect(html).toContain("B → C");

    // Unchanged chip (.position-grade-chip.neutral)
    expect(html).toMatch(/position-grade-chip\s+neutral/);
    expect(html).toContain("QB");
    expect(html).toContain("B+ → B+");
  });

  it("renders opponent chips with team designation when other team has grade changes", () => {
    const impact: ChainPositionImpact = {
      own: [],
      other: [
        {
          position: "TE",
          before: "B",
          after: "C-",
          drop: 3,
          stepDelta: -3,
        },
      ],
    };

    const html = renderToStaticMarkup(
      React.createElement(PositionGradeChips, {
        impact,
      })
    );

    expect(html).toContain("TE (them)");
    expect(html).toContain("B → C-");
    expect(html).toMatch(/position-grade-chip\s+bad/);
  });

  it("renders null when impact is undefined or has no changes", () => {
    const htmlEmpty = renderToStaticMarkup(
      React.createElement(PositionGradeChips, {
        impact: { own: [], other: [] },
      })
    );
    expect(htmlEmpty).toBe("");

    const htmlUndefined = renderToStaticMarkup(
      React.createElement(PositionGradeChips, {
        impact: undefined,
      })
    );
    expect(htmlUndefined).toBe("");
  });
});

describe("availableStarterPositions domain helper", () => {
  it("extracts all standard starter positions when all slots are > 0", async () => {
    const { availableStarterPositions } = await import(
      "../src/domain/chain-position-impact"
    );
    const mockModel: any = {
      dataset: {
        tables: {
          ModelContext: [
            {
              QBSlots: 1,
              RBSlots: 2,
              WRSlots: 2,
              TESlots: 1,
              FlexSlots: 1,
              KSlots: 1,
              DSTSlots: 1,
            },
          ],
        },
      },
    };

    expect(availableStarterPositions(mockModel)).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "FLEX",
      "K",
      "D/ST",
    ]);
  });

  it("omits positions when their slot count is 0", async () => {
    const { availableStarterPositions } = await import(
      "../src/domain/chain-position-impact"
    );
    const mockModel: any = {
      dataset: {
        tables: {
          ModelContext: [
            {
              QBSlots: 1,
              RBSlots: 2,
              WRSlots: 3,
              TESlots: 1,
              FlexSlots: 0,
              KSlots: 0,
              DSTSlots: 1,
            },
          ],
        },
      },
    };

    expect(availableStarterPositions(mockModel)).toEqual([
      "QB",
      "RB",
      "WR",
      "TE",
      "D/ST",
    ]);
  });
});

describe("UI Integration: PositionGradeChips tooltips", () => {
  it("uses proper tooltip for upgrades, downgrades, and unchanged grades", () => {
    const impact: ChainPositionImpact = {
      own: [
        { position: "WR", before: "C", after: "B", drop: 0, stepDelta: 2 },
        { position: "RB", before: "B", after: "C", drop: 2, stepDelta: -2 },
        { position: "TE", before: "B", after: "B", drop: null, stepDelta: null },
      ],
      other: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(PositionGradeChips, { impact })
    );

    expect(html).toContain('title="WR upgraded"');
    expect(html).toContain('title="RB drops 2 steps"');
    expect(html).toContain('title="TE unchanged"');
  });
});

describe("Positional grade goal chip label formatting", () => {
  function formatGradeGoalChip(rule: PositionalGradeImpactRule) {
    const sidePrefix = rule.side === "own" ? "Your" : "Their";
    const stepCount = Math.abs(rule.steps);
    const stepLabel = `${stepCount} step${stepCount === 1 ? "" : "s"}`;
    let action: string;
    if (rule.side === "other" && rule.steps < 0) {
      action = `downgrade ≥ ${stepLabel}`;
    } else if (rule.steps > 0) {
      action = `upgrade ≥ ${stepLabel}`;
    } else if (rule.steps === 0) {
      action = "no drop";
    } else {
      action = `drop ≤ ${stepLabel}`;
    }
    return `Grade goal: ${sidePrefix} ${rule.position} (${action})`;
  }

  it("formats upgrade goals clearly", () => {
    expect(
      formatGradeGoalChip({ id: "1", side: "own", position: "WR", steps: 2 })
    ).toBe("Grade goal: Your WR (upgrade ≥ 2 steps)");
    expect(
      formatGradeGoalChip({ id: "1", side: "own", position: "TE", steps: 1 })
    ).toBe("Grade goal: Your TE (upgrade ≥ 1 step)");
  });

  it("formats no-drop goals clearly", () => {
    expect(
      formatGradeGoalChip({ id: "1", side: "own", position: "QB", steps: 0 })
    ).toBe("Grade goal: Your QB (no drop)");
  });

  it("formats drop limit goals clearly", () => {
    expect(
      formatGradeGoalChip({ id: "1", side: "own", position: "RB", steps: -1 })
    ).toBe("Grade goal: Your RB (drop ≤ 1 step)");
  });

  it("formats opponent depletion downgrade goals clearly without negative signs", () => {
    expect(
      formatGradeGoalChip({ id: "1", side: "other", position: "WR", steps: -2 })
    ).toBe("Grade goal: Their WR (downgrade ≥ 2 steps)");
  });
});
