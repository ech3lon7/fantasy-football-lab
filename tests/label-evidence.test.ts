import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import references from "../src/domain/historical-label-reference.json";
import { labelEvidenceBinding } from "../src/domain/label-evidence-binding";
import {
  defaultGemRules,
  effectiveLabelRules,
  gemVersion,
  labelPolicy,
  labelRuleVersion,
} from "../src/domain/label-rules";
import {
  assessGem,
  defaultGemRules as compatibilityRules,
} from "../src/domain/gems";
import {
  historicalLabelAudit,
  historicalLabelContext,
} from "../src/domain/historical-label-reference";
import { evaluate } from "../src/domain/valuation";
import { playedHistory } from "../src/domain/opportunity";
import { fixture } from "./fixtures";

// Normalize only CRLF line endings; all research content, formatting and other bytes remain protected by the fingerprint.
const aggregateHash = (text: string) =>
  createHash("sha256")
    .update(text.replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");

// Freeze the deployed aggregate text and researched classifier configuration consistently on Windows and Linux.
it("binds aggregates, research replay and the exact Gem/Watch policy version", () => {
  const text = readFileSync(
    new URL("../src/domain/historical-label-reference.json", import.meta.url),
    "utf8",
  );
  expect(aggregateHash(text)).toBe(labelEvidenceBinding.aggregateSHA256);
  expect(references.sourceSHA256).toBe(labelEvidenceBinding.sourceSHA256);
  expect(references.researchSHA256).toBe(labelEvidenceBinding.researchSHA256);
  expect(gemVersion).toBe(references.classifierVersion);
  expect(labelRuleVersion).toBe(references.registryVersion);
  expect(labelEvidenceBinding.classifierVersion).toBe(gemVersion);
  expect(labelEvidenceBinding.registryVersion).toBe(labelRuleVersion);
  expect(labelEvidenceBinding.referenceVersion).toBe(references.version);
  expect(defaultGemRules).toEqual(references.gemConfiguration);
  expect(labelPolicy).toEqual(references.policyConfiguration);
  expect(compatibilityRules).toBe(defaultGemRules);
});

// Exercise both checkout formats and a substantive data edit so portability does not weaken the integrity check.
it("accepts LF and CRLF aggregates but still rejects changed research content", () => {
  const lf = readFileSync(
    new URL("../src/domain/historical-label-reference.json", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  expect(aggregateHash(lf)).toBe(labelEvidenceBinding.aggregateSHA256);
  expect(aggregateHash(lf.replace(/\n/g, "\r\n"))).toBe(
    labelEvidenceBinding.aggregateSHA256,
  );
  const changed = lf.replace(
    /"version":\s*"[^"]+"/,
    '"version": "changed-research"',
  );
  expect(changed).not.toBe(lf);
  expect(aggregateHash(changed)).not.toBe(labelEvidenceBinding.aggregateSHA256);
});

// User overrides remain effective for their original labels and cannot silently alter primary Gem/Watch means.
it("reports custom setting applicability without resetting or cross-binding settings", async () => {
  const d = await fixture();
  const settings = { ...d.settings, GemWRTargets: 9, GemMinGap: 4 };
  const before = JSON.stringify(settings);
  const rules = effectiveLabelRules(settings);
  expect(
    rules
      .find((r) => r.id === "Role-growth watch")!
      .parameters.find((p) => p.id === "GemWRTargets")!.value,
  ).toBe(9);
  expect(rules.find((r) => r.id === "Role-growth watch")!.evidence).toContain(
    "custom settings",
  );
  expect(
    rules
      .find((r) => r.id === "Gem")!
      .parameters.find((p) => p.id === "WR.mean")!.value,
  ).toBe(7);
  expect(JSON.stringify(settings)).toBe(before);
});

// A shared mean edit must affect both Gem and Watch; registry metadata cannot disguise that coupling as a Gem-only setting.
it("retains the shared Gem/Watch mean binding and withholds research when it changes", async () => {
  const d = await fixture([16, 16, 16, 16, 16]);
  const raw = d.tables.ModelPlayers[0];
  raw.Position = "WR";
  d.tables.ModelHistory.filter((r) => r.PlayerID === 1).forEach((r) =>
    Object.assign(r, { Targets: 7, RushAttempts: 0 }),
  );
  const m = evaluate(d, d.settings),
    p = m.byId.get("1")!;
  const history = playedHistory(d).get("1")!;
  const short = { ...p, games: 3 };
  expect(assessGem(p, history, d).classification).toBe("Gem");
  expect(assessGem(short, history.slice(-3), d).classification).toBe("Watch");
  const before = defaultGemRules.positions.WR.mean;
  try {
    defaultGemRules.positions.WR.mean = 8;
    expect(assessGem(p, history, d).classification).toBe("No breakout signal");
    expect(assessGem(short, history.slice(-3), d).classification).toBe(
      "No breakout signal",
    );
    const rules = effectiveLabelRules(d.settings);
    for (const id of ["Gem", "Watch"])
      expect(
        rules
          .find((r) => r.id === id)!
          .parameters.find((p) => p.id === "WR.mean"),
      ).toMatchObject({ value: 8, binding: "Gem + Watch.positions.WR.mean" });
    expect(historicalLabelAudit(m).rows).toEqual([]);
  } finally {
    defaultGemRules.positions.WR.mean = before;
  }
});

// Every packaged distribution contains only finite metric-specific contributions, meaningful units and aggregate counts.
it("packages descriptive metric counts without historical identities or irrelevant QB targets", () => {
  expect(references.references).toHaveLength(29);
  expect(
    references.references.some(
      (r) => r.position === "QB" && r.metric === "targets",
    ),
  ).toBe(false);
  for (const r of references.references) {
    expect(r.observations).toBe(
      Object.values(r.bySeason).reduce((a, b) => a + b, 0),
    );
    expect(r.players).toBeGreaterThan(0);
    expect(r.playerSeasons).toBeGreaterThanOrEqual(r.players);
    expect(r.observations).toBeGreaterThanOrEqual(r.playerSeasons);
    expect([r.p10, r.p25, r.median, r.p75, r.p90]).toEqual(
      [r.p10, r.p25, r.median, r.p75, r.p90].sort((a, b) => a - b),
    );
    expect(
      Object.values(r).some(
        (v) => typeof v === "number" && !Number.isFinite(v),
      ),
    ).toBe(false);
  }
  const body = JSON.stringify(references);
  expect(body).not.toMatch(
    /PlayerID|RawStatRecordJSON|C:\\|Downloads|PlayerName/,
  );
});

// Keep three-game descriptive references out of individual-game support rows, early samples and incompatible PPG scoring.
it("matches reference windows and explicitly withholds unverifiable scoring comparisons", async () => {
  const d = await fixture();
  const m = evaluate(d, d.settings),
    p = { ...m.byId.get("1")!, pos: "WR" as const };
  const text = historicalLabelContext(
    "Gem",
    "Recent window targets / game",
    p,
    m,
  )!;
  expect(text.text).toContain(
    "Historical nine-team modeled starter-quality WR",
  );
  expect(text.text).toContain("8.33 targets/game");
  expect(text.text).toContain("not a qualification cutoff");
  expect(
    historicalLabelContext("Gem", "Recent window workload support", p, m),
  ).toBeUndefined();
  expect(
    historicalLabelContext("Gem", "Previous window actual PPG", p, m),
  ).toBeUndefined();
  expect(
    historicalLabelContext("Watch", "Recent workload", { ...p, games: 2 }, m),
  ).toBeUndefined();
  expect(
    historicalLabelContext(
      "Watch",
      "Positive workload change",
      { ...p, games: 4 },
      m,
    ),
  ).toBeUndefined();
  expect(
    historicalLabelContext("Gem", "Recent window actual PPG", p, m)!.text,
  ).toContain("compatibility is not fully verified");
  // Matching observed weights permits descriptive PPG context; an override or different scoring suppresses it again.
  d.tables.ModelContext[0].ScoringItemsJSON = JSON.stringify(
    Object.entries(references.observedScoringWeights).map(
      ([statId, points]) => ({
        statId: Number(statId),
        points,
        pointsOverrides: {},
        isReverseItem: false,
      }),
    ),
  );
  expect(
    historicalLabelContext("Gem", "Recent window actual PPG", p, m)!.text,
  ).toContain("Historical nine-team");
  const items = JSON.parse(String(d.tables.ModelContext[0].ScoringItemsJSON));
  items.find((r: { statId: number }) => r.statId === 53).points = 0.5;
  d.tables.ModelContext[0].ScoringItemsJSON = JSON.stringify(items);
  expect(
    historicalLabelContext("Gem", "Recent window actual PPG", p, m)!.text,
  ).toContain("compatibility is not fully verified");
  expect(
    historicalLabelContext("BUY LOW", "Positional volume test", p, m),
  ).toBeUndefined();
});

// Report different observational units separately, retain missing-follow-up failures and use their own matched base rates.
it("keeps first-alert and weekly calibration units and denominators explicit", async () => {
  const d = await fixture(),
    m = evaluate(d, d.settings);
  const before = JSON.stringify(m);
  const audit = historicalLabelAudit(m);
  expect(audit.rows.find((r) => r.id === "Gem:firstAlert")).toMatchObject({
    sample: "96/154",
    rate: "62.3%",
    base: "14.8%",
    lift: "4.22×",
  });
  expect(audit.rows.find((r) => r.id === "Gem:weekly")).toMatchObject({
    sample: "323/494",
    rate: "65.4%",
    base: "14.6%",
    lift: "4.48×",
  });
  expect(audit.volume).toContain("33 season-weeks");
  expect(audit.outcome).toContain(
    "fewer than two future appearances counts as failure",
  );
  expect(audit.limitations).toContain(
    "Not acquisition success or an individual probability",
  );
  expect(JSON.stringify(m)).toBe(before);
});
