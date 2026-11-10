import { describe, expect, it } from "vitest";
import { readUiPreview, writeUiPreview } from "../src/ui/preview";

// Guard the rule that the current interface stays the default until the cutover release.
describe("Gameday Plus preview switch", () => {
  it("defaults to off when nothing is stored or the value is unknown", () => {
    expect(readUiPreview(undefined)).toBe(false);
    expect(readUiPreview("")).toBe(false);
    expect(readUiPreview("true")).toBe(false);
  });
  it("round-trips the explicit on and off choices", () => {
    expect(readUiPreview(writeUiPreview(true))).toBe(true);
    expect(readUiPreview(writeUiPreview(false))).toBe(false);
  });
});
