import { describe, expect, it } from "vitest";
import {
  isEditableTarget,
  nextRowIndex,
  trapIndex,
} from "../src/ui/popover/keys";

// Pin each keyboard rule from the design so the popover stack and lists cannot drift apart.
describe("Tab trap", () => {
  it("wraps forwards and backwards inside the popover", () => {
    expect(trapIndex(2, 3, false)).toBe(0);
    expect(trapIndex(0, 3, true)).toBe(2);
    expect(trapIndex(1, 3, false)).toBe(2);
    expect(trapIndex(1, 3, true)).toBe(0);
  });
  it("enters at the first or last control when focus is outside", () => {
    expect(trapIndex(-1, 3, false)).toBe(0);
    expect(trapIndex(-1, 3, true)).toBe(2);
    expect(trapIndex(0, 0, false)).toBe(-1);
  });
});

describe("row navigation", () => {
  it("moves one row and stops at the ends", () => {
    expect(nextRowIndex(0, 4, "ArrowDown")).toBe(1);
    expect(nextRowIndex(3, 4, "ArrowDown")).toBe(3);
    expect(nextRowIndex(0, 4, "ArrowUp")).toBe(0);
    expect(nextRowIndex(2, 4, "ArrowUp")).toBe(1);
  });
  it("starts at the first or last row when no row has focus", () => {
    expect(nextRowIndex(-1, 4, "ArrowDown")).toBe(0);
    expect(nextRowIndex(-1, 4, "ArrowUp")).toBe(3);
    expect(nextRowIndex(0, 0, "ArrowDown")).toBe(-1);
  });
});

describe("editable targets", () => {
  it("ignores fields that use arrow keys themselves", () => {
    for (const tagName of ["INPUT", "SELECT", "TEXTAREA"])
      expect(isEditableTarget({ tagName })).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true })).toBe(
      true,
    );
    for (const role of ["slider", "textbox", "combobox"])
      expect(
        isEditableTarget({ tagName: "DIV", getAttribute: () => role }),
      ).toBe(true);
  });
  it("lets links, buttons and rows through", () => {
    for (const tagName of ["A", "BUTTON", "TR", "DIV"])
      expect(isEditableTarget({ tagName, getAttribute: () => null })).toBe(
        false,
      );
  });
});
