import fs from "node:fs/promises";
import { fromTables, importWorkbook } from "../src/import/workbook";
import { evaluate } from "../src/domain/valuation";
const raw = JSON.parse(await fs.readFile(".private/reference.json", "utf8"));
const d = await fromTables(raw.tables, raw.settings);
const m = evaluate(d, raw.settings);
const mapping = {
  GamesPlayed: "games",
  ActualPPG: "actual",
  RecentPPG: "recent",
  ProjectedPPG: "projected",
  ExpectedPPG: "expected",
  ConsistencyPenalty: "penalty",
  ValuePPG: "value",
  BaselinePPG: "baseline",
  PlayerVORP: "vorp",
  PositiveVORP: "positive",
  PlayerIndices: "index",
  OffensiveRank: "rank",
  MarketEdge: "edge",
  RushShare: "rushShare",
  TargetShare: "targetShare",
  Opportunities: "opportunities",
  RelevantTD: "td",
  ExpectedTD: "xtd",
  RegressionAlert: "regression",
  GemSignal: "gem",
  GemEarlierPPG: "earlier",
  GemTrendDelta: "trendDelta",
  GemTrendPct: "trendPct",
  GemTrendArrow: "arrow",
  GemProjectionGap: "gap",
  GemProjectionPct: "gapPct",
  GemWorkloadPerGame: "workload",
  GemWorkloadSupport: "workloadSupport",
} as const;
const errors: string[] = [];
let checks = 0;
for (const p of m.players) {
  const ref = raw.reference[p.id];
  for (const [key, prop] of Object.entries(mapping)) {
    if (!(key in ref)) continue;
    checks++;
    const expected = ref[key] === "n.a." && prop !== "arrow" ? null : ref[key],
      actual = p[prop as keyof typeof p];
    if (
      typeof expected === "number"
        ? typeof actual === "boolean"
          ? Number(actual) !== expected
          : typeof actual !== "number" || Math.abs(expected - actual) > 1e-8
        : expected !== actual
    )
      errors.push(`${p.id} ${key}: ${actual} vs ${expected}`);
  }
}
if (errors.length) {
  console.error(errors.slice(0, 25).join("\n"));
  throw Error(
    `${errors.length} parity differences across ${checks} comparisons`,
  );
}
console.log(
  `PASS: ${checks} native-Excel metric comparisons across ${m.players.length} players.`,
);
if (process.argv[2]) {
  const bytes = new Uint8Array(await fs.readFile(process.argv[2]));
  const result = await importWorkbook(bytes);
  console.log("PASS: actual XLSX importer:", result.summary);
}
