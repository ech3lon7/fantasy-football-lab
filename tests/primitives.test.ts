import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  barPositions,
  isEdited,
  readOpenGroups,
  setGroupOpen,
} from "../src/domain/view/primitives";
import {
  Chip,
  FloorCeilingBar,
  FoldingGroup,
  RangeSlider,
  Segmented,
} from "../src/ui/primitives";

describe("floor-to-ceiling positions", () => {
  it("places values on the scale and clamps to its ends", () => {
    expect(
      barPositions(
        { floor: 5, expected: 10, ceiling: 15 },
        { min: 0, max: 20 },
      ),
    ).toEqual({ floor: 25, expected: 50, ceiling: 75, width: 50 });
    expect(
      barPositions(
        { floor: -4, expected: 10, ceiling: 40 },
        { min: 0, max: 20 },
      ),
    ).toMatchObject({ floor: 0, ceiling: 100 });
  });
  it("returns null for any missing value or an empty scale, never zero", () => {
    expect(
      barPositions(
        { floor: null, expected: 10, ceiling: 15 },
        { min: 0, max: 20 },
      ),
    ).toBeNull();
    expect(
      barPositions({ floor: 0, expected: 0, ceiling: 0 }, { min: 5, max: 5 }),
    ).toBeNull();
  });
});

describe("edited and folded state", () => {
  it("marks only real differences from the default", () => {
    expect(isEdited(3, 3)).toBe(false);
    expect(isEdited(4, 3)).toBe(true);
    expect(isEdited(null, 3)).toBe(false);
    expect(isEdited(undefined, 3)).toBe(false);
  });
  it("round-trips open groups and ignores malformed saved values", () => {
    const raw = setGroupOpen(
      setGroupOpen(undefined, "limits", true),
      "teams",
      false,
    );
    expect(readOpenGroups(raw)).toEqual({ limits: true, teams: false });
    for (const bad of [undefined, "", "{", "[]", '"x"', '{"a":1}'])
      expect(readOpenGroups(bad)).toEqual({});
  });
});

describe("primitive markup", () => {
  const fold = (open: boolean, edited: boolean) =>
    renderToStaticMarkup(
      h(FoldingGroup, {
        title: "Search limits",
        summary: "Gain 3.0 · window ±10",
        open,
        edited,
        onToggle: () => {},
        children: h("p", null, "Body"),
      }),
    );
  it("shows a folded group's summary and edited marker, and drops the summary when open", () => {
    const folded = fold(false, true);
    expect(folded).toContain("Gain 3.0 · window ±10");
    expect(folded).toContain("edited");
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).not.toContain("Body");
    const open = fold(true, false);
    expect(open).toContain("Body");
    expect(open).not.toContain("Gain 3.0");
    expect(open).not.toContain("edited");
  });
  it("marks an edited slider and leaves a default one unmarked", () => {
    const render = (value: number) =>
      renderToStaticMarkup(
        h(RangeSlider, {
          label: "Window",
          value,
          fallback: 10,
          min: 0,
          max: 20,
          onChange: () => {},
        }),
      );
    expect(render(12)).toContain("edited");
    expect(render(10)).not.toContain("edited");
  });
  it("renders a dash with a reason when the range is unavailable", () => {
    const html = renderToStaticMarkup(
      h(FloorCeilingBar, {
        range: { floor: null, expected: 9, ceiling: 12 },
        scale: { min: 0, max: 20 },
        unavailableReason: "Needs three games",
      }),
    );
    expect(html).toContain("—");
    expect(html).toContain("Needs three games");
    expect(html).not.toContain("gd-range-span");
  });
  it("keeps chip meaning in text and segmented selection in aria-pressed", () => {
    expect(
      renderToStaticMarkup(h(Chip, { tone: "warning", children: "Stale" })),
    ).toContain("Stale");
    const seg = renderToStaticMarkup(
      h(Segmented<"light" | "dark">, {
        label: "Theme",
        options: ["light", "dark"],
        value: "dark",
        onChange: () => {},
      }),
    );
    expect(seg).toContain('aria-pressed="true"');
    expect(seg.match(/aria-pressed="false"/g)).toHaveLength(1);
  });
});
