import fs from "node:fs/promises";
import { fromTables } from "../src/import/workbook";
import { evaluate } from "../src/domain/valuation";
import { teamsAssessment } from "../src/domain/lineups";
import { evaluateTrade } from "../src/domain/trades";
const raw = JSON.parse(await fs.readFile(".private/reference.json", "utf8")),
  ref = JSON.parse(
    (await fs.readFile(".private/native-scenarios.json", "utf8")).replace(
      /^\uFEFF/,
      "",
    ),
  );
const m = evaluate(await fromTables(raw.tables, raw.settings), raw.settings),
  grades = teamsAssessment(m),
  errors: string[] = [];
let checked = 0;
function equal(a: unknown, b: unknown, label: string) {
  checked++;
  if (
    typeof b === "number"
      ? typeof a !== "number" || Math.abs(a - b) > 1e-8
      : JSON.stringify(a) !== JSON.stringify(b)
  )
    errors.push(`${label}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
}
for (const team of ref.teams)
  for (const g of team.grades) {
    const a = grades.get(team.team)!.find((x) => x.position === g.position)!;
    equal(
      a.grade.replace("−", "-"),
      g.grade,
      `${team.team} ${g.position} grade`,
    );
    equal(a.starterValue, g.value, `${team.team} ${g.position} value`);
    equal(a.median, g.median, `${team.team} ${g.position} median`);
    equal(a.coverage, g.coverage, `${team.team} ${g.position} coverage`);
    equal(a.balance, g.balance, `${team.team} ${g.position} balance`);
  }
let maxMs = 0;
for (const c of ref.cases) {
  const start = performance.now(),
    r = evaluateTrade(
      m,
      { teamA: c.teamA, teamB: c.teamB, give: c.give, get: c.get },
      true,
    );
  maxMs = Math.max(maxMs, performance.now() - start);
  if (!r.valid) {
    errors.push(`${c.give.length}/${c.get.length}: invalid ${r.errors}`);
    continue;
  }
  const label = `${c.give.length}-for-${c.get.length}`;
  for (const key of [
    "outgoing",
    "incoming",
    "dropCost",
    "legalA",
    "legalB",
    "addsA",
    "addsB",
    "dropsA",
    "dropsB",
  ] as const)
    equal(r[key], c[key], `${label} ${key}`);
  for (const [key, actual] of Object.entries({
    yourExpected: r.a.expected,
    theirExpected: r.b.expected,
    yourValue: r.a.value,
    theirValue: r.b.value,
    yourWaiver: r.a.waiverExpected,
    theirWaiver: r.b.waiverExpected,
    yourDownside: r.a.downside,
    theirDownside: r.b.downside,
  }))
    equal(actual, c[key], `${label} ${key}`);
  equal(r.surplusTest, c.surplusTest.split(" ")[0], `${label} surplusTest`);
  equal(r.pointsTest, c.pointsTest.split(" ")[0], `${label} pointsTest`);
  if (c.give.length !== c.get.length)
    for (const key of [
      "requiredSurplus",
      "actualSurplus",
      "requiredPoints",
      "actualPoints",
    ] as const)
      equal(r[key], c[key], `${label} ${key}`);
}
if (errors.length) {
  console.error(errors.slice(0, 30).join("\n"));
  throw Error(`${errors.length} scenario differences`);
}
console.log(
  `PASS: ${checked} comparisons across all nine team grades and 25 native Excel trade scenarios. Slowest trade ${maxMs.toFixed(0)} ms.`,
);
