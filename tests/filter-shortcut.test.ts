import { describe, expect, it } from "vitest";
import { appUsedKeys, filterShortcut, filterShortcutProblem } from "../src/features/next/trade/filter-shortcut";
import { shortcuts } from "../src/features/next/shortcut-list";

const press = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}, code = "") =>
  ({ key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }) as KeyboardEvent;

describe("filter wheel shortcut validation (F5)", () => {
  it("reads the app's used keys from the keyboard reference list", () => {
    expect([...appUsedKeys()].sort()).toEqual(["arrowdown", "arrowleft", "arrowright", "arrowup", "escape", "tab"]);
    expect(shortcuts.length).toBeGreaterThan(0);
  });
  it("rejects every key the keyboard reference lists, with or without a modifier", () => {
    for (const key of ["Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      expect(filterShortcutProblem(press(key, { shiftKey: true }))).toMatch(/already used by the app/);
      expect(filterShortcutProblem(press(key, { ctrlKey: true }))).toMatch(/already used by the app/);
    }
  });
  it("rejects browser-reserved combinations", () => {
    for (const key of ["w", "t", "n", "l", "r"]) expect(filterShortcutProblem(press(key, { ctrlKey: true }))).toMatch(/browser/);
    expect(filterShortcutProblem(press("t", { metaKey: true }))).toMatch(/browser/);
  });
  it("accepts Shift+Space, Shift+G and Alt+F", () => {
    expect(filterShortcutProblem(press(" ", { shiftKey: true }, "Space"))).toBeNull();
    expect(filterShortcutProblem(press("G", { shiftKey: true }))).toBeNull();
    expect(filterShortcutProblem(press("f", { altKey: true }))).toBeNull();
  });
  it("normalises the stored value and ignores a bare modifier or an unmodified key", () => {
    expect(filterShortcut(press(" ", { shiftKey: true }, "Space"))).toBe("Shift+Space");
    expect(filterShortcut(press("g", { shiftKey: true }))).toBe("Shift+G");
    expect(filterShortcut(press("Shift", { shiftKey: true }))).toBeNull();
    expect(filterShortcut(press("g"))).toBeNull();
  });
});
