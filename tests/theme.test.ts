import { describe, expect, it } from "vitest";
import {
  readThemePref,
  resolveTheme,
  writeThemePref,
} from "../src/ui/feel/theme";

// The resolver decides which token set the whole interface uses, so each branch is pinned.
describe("theme resolver", () => {
  it("follows the device only when the preference is System", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  it("lets an explicit choice override the device", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("falls back to System for missing or unknown saved values", () => {
    expect(readThemePref(undefined)).toBe("system");
    expect(readThemePref("")).toBe("system");
    expect(readThemePref("sepia")).toBe("system");
  });
  it("round-trips every preference and stores System as empty", () => {
    for (const pref of ["system", "light", "dark"] as const)
      expect(readThemePref(writeThemePref(pref))).toBe(pref);
    expect(writeThemePref("system")).toBe("");
  });
});
