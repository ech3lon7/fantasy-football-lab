import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PositionalGradeImpactControls } from "../src/features/PositionalGradeImpactControls";
import type { PositionalGradeImpactRule } from "../src/domain/chain-position-impact";

describe("PositionalGradeImpactControls component", () => {
  it("renders empty state hint when no rules configured", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(PositionalGradeImpactControls, {
        rules: [],
        onChange,
      })
    );

    expect(html).toContain("No positional grade goals configured.");
    expect(html).toContain("+ Add Positional Goal");
    expect(html).toContain("grade-impact-container");
    expect(html).toContain("grade-impact-add-btn");
  });

  it("renders default position options when positions prop is not provided", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "WR", steps: 2 },
    ];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(PositionalGradeImpactControls, {
        rules,
        onChange,
      })
    );

    const defaultPositions = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];
    for (const pos of defaultPositions) {
      expect(html).toMatch(new RegExp(`<option[^>]*value="${pos}"[^>]*>${pos}</option>`));
    }
  });

  it("renders custom position options when provided", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "RB", steps: 1 },
    ];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(PositionalGradeImpactControls, {
        rules,
        onChange,
        positions: ["RB", "WR", "TE"],
      })
    );

    expect(html).toMatch(/<option[^>]*value="RB"[^>]*>RB<\/option>/);
    expect(html).toMatch(/<option[^>]*value="WR"[^>]*>WR<\/option>/);
    expect(html).toMatch(/<option[^>]*value="TE"[^>]*>TE<\/option>/);
    expect(html).not.toContain('value="QB"');
  });

  it("renders own team steps dropdown options correctly", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "WR", steps: 2 },
    ];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(PositionalGradeImpactControls, {
        rules,
        onChange,
      })
    );

    expect(html).toContain("Upgrade ≥ 5 steps");
    expect(html).toContain("Upgrade ≥ 4 steps");
    expect(html).toContain("Upgrade ≥ 3 steps");
    expect(html).toContain("Upgrade ≥ 2 steps");
    expect(html).toContain("Upgrade ≥ 1 step");
    expect(html).toContain("No drop (≥ 0)");
    expect(html).toContain("Drop at most 1 step");
    expect(html).toContain("Drop at most 2 steps");
    expect(html).toContain("Drop at most 3 steps");
    expect(html).toContain("Drop at most 4 steps");
    expect(html).toContain("Drop at most 5 steps");
  });

  it("renders other team steps dropdown options correctly", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r2", side: "other", position: "QB", steps: -2 },
    ];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(PositionalGradeImpactControls, {
        rules,
        onChange,
      })
    );

    expect(html).toContain("Upgrade ≥ 5 steps");
    expect(html).toContain("Upgrade ≥ 4 steps");
    expect(html).toContain("Upgrade ≥ 3 steps");
    expect(html).toContain("Upgrade ≥ 2 steps");
    expect(html).toContain("Upgrade ≥ 1 step");
    expect(html).toContain("No drop for them (≥ 0)");
    expect(html).toContain("Downgrade by ≥ 1 step");
    expect(html).toContain("Downgrade by ≥ 2 steps");
    expect(html).toContain("Downgrade by ≥ 3 steps");
    expect(html).toContain("Downgrade by ≥ 4 steps");
    expect(html).toContain("Downgrade by ≥ 5 steps");
  });

  it("supports adding a new rule with + Add Positional Goal button", () => {
    const onChange = vi.fn();
    const vdom = PositionalGradeImpactControls({
      rules: [],
      onChange,
      positions: ["RB", "WR"],
    });

    // Find add button
    const findButton = (node: any): any => {
      if (!node || typeof node !== "object") return null;
      if (node.props?.className?.includes("grade-impact-add-btn")) return node;
      if (Array.isArray(node.props?.children)) {
        for (const child of node.props.children) {
          const res = findButton(child);
          if (res) return res;
        }
      } else if (node.props?.children) {
        return findButton(node.props.children);
      }
      return null;
    };

    const addBtn = findButton(vdom);
    expect(addBtn).toBeDefined();
    addBtn.props.onClick();

    expect(onChange).toHaveBeenCalledTimes(1);
    const updated = onChange.mock.calls[0][0];
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({
      side: "own",
      position: "RB",
      steps: 2,
    });
    expect(typeof updated[0].id).toBe("string");
    expect(updated[0].id.length).toBeGreaterThan(0);
  });

  it("supports modifying fields on an existing rule", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "rule-1", side: "own", position: "WR", steps: 2 },
    ];
    const onChange = vi.fn();
    const vdom = PositionalGradeImpactControls({
      rules,
      onChange,
    });

    const findSelects = (node: any, results: any[] = []): any[] => {
      if (!node || typeof node !== "object") return results;
      if (node.type === "select" || node.props?.className?.includes("grade-impact-select")) {
        results.push(node);
      }
      if (Array.isArray(node.props?.children)) {
        for (const child of node.props.children) {
          findSelects(child, results);
        }
      } else if (node.props?.children) {
        findSelects(node.props.children, results);
      }
      return results;
    };

    const selects = findSelects(vdom);
    expect(selects.length).toBe(3); // side, position, steps

    // Change side to 'other'
    const sideSelect = selects[0];
    sideSelect.props.onChange({ target: { value: "other" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "rule-1", side: "other", position: "WR", steps: 2 },
    ]);

    // Change position to 'TE'
    const posSelect = selects[1];
    posSelect.props.onChange({ target: { value: "TE" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "rule-1", side: "own", position: "TE", steps: 2 },
    ]);

    // Change steps to 4
    const stepsSelect = selects[2];
    stepsSelect.props.onChange({ target: { value: "4" } });
    expect(onChange).toHaveBeenLastCalledWith([
      { id: "rule-1", side: "own", position: "WR", steps: 4 },
    ]);
  });

  it("supports deleting a rule with remove button", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "rule-1", side: "own", position: "WR", steps: 2 },
      { id: "rule-2", side: "other", position: "RB", steps: -1 },
    ];
    const onChange = vi.fn();
    const vdom = PositionalGradeImpactControls({
      rules,
      onChange,
    });

    const findRemoveButtons = (node: any, results: any[] = []): any[] => {
      if (!node || typeof node !== "object") return results;
      if (node.props?.className?.includes("grade-impact-remove")) {
        results.push(node);
      }
      if (Array.isArray(node.props?.children)) {
        for (const child of node.props.children) {
          findRemoveButtons(child, results);
        }
      } else if (node.props?.children) {
        findRemoveButtons(node.props.children, results);
      }
      return results;
    };

    const removeButtons = findRemoveButtons(vdom);
    expect(removeButtons.length).toBe(2);

    // Remove first rule
    removeButtons[0].props.onClick();
    expect(onChange).toHaveBeenCalledWith([
      { id: "rule-2", side: "other", position: "RB", steps: -1 },
    ]);
  });

  it("applies ariaLabelPrefix for accessible labeling", () => {
    const rules: PositionalGradeImpactRule[] = [
      { id: "r1", side: "own", position: "WR", steps: 2 },
    ];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(
      React.createElement(PositionalGradeImpactControls, {
        rules,
        onChange,
        ariaLabelPrefix: "Trade leg 1 grade goal",
      })
    );

    expect(html).toContain('aria-label="Trade leg 1 grade goal 1 team"');
    expect(html).toContain('aria-label="Trade leg 1 grade goal 1 position"');
    expect(html).toContain('aria-label="Trade leg 1 grade goal 1 target"');
    expect(html).toContain('aria-label="Trade leg 1 grade goal 1 remove"');
  });
});
