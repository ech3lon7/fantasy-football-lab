import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RETIRED_FILES = [
  "TradeSearch",
  "TradeChains",
  "TradeSearchControls",
  "TradeDiscovery",
  "ChainLegControls",
  "PositionalGradeImpactControls",
  "DeficitProtectionControls",
  "TradeResultGroups",
];

function getFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getFiles(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("5.1 Static acceptance test: retire legacy trade components", () => {
  it("fails if any file under src/features/next/ or src/app/ imports retired trade components", () => {
    const dirs = ["src/features/next", "src/app"];
    const allFiles = dirs.flatMap((d) => getFiles(d));
    const violations: { file: string; match: string }[] = [];

    for (const file of allFiles) {
      const content = readFileSync(file, "utf8");
      for (const retired of RETIRED_FILES) {
        // match import ... from ".../TradeSearch" or similar
        const regex = new RegExp(`from\\s+['"][^'"]*\\b${retired}\\b['"]`, "g");
        if (regex.test(content)) {
          violations.push({ file, match: retired });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("2.3 the retired trade files are deleted", () => {
  it("none of the old screens exists under src/features", () => {
    const present = RETIRED_FILES.filter((name) =>
      existsSync(join("src/features", `${name}.tsx`)),
    );
    expect(present).toEqual([]);
  });
});

describe("2.2 the rebuilt screens use only gd- classes and tokens", () => {
  const dir = "src/features/next/trade";
  const files = existsSync(dir) ? getFiles(dir).filter((f) => f.endsWith(".tsx")) : [];

  it("the new folder exists with both screens", () => {
    expect(existsSync(join(dir, "FindTrades.tsx"))).toBe(true);
    expect(existsSync(join(dir, "ChainPlanner.tsx"))).toBe(true);
  });

  it("has no literal colours", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g))
        offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("names every class with the gd- prefix", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g))
        for (const token of (m[1] ?? m[2] ?? "").split(/\s+/))
          if (token && !token.startsWith("gd-") && !token.startsWith("$"))
            offenders.push(`${f}: ${token}`);
    }
    expect(offenders).toEqual([]);
  });

  it("never renders invented sample rows or constants for results", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (/sample-trade|sampleRow|Blended spread|"WR \+1"/.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
