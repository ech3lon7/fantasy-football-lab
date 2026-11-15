// T0 measurement for the one-search design: time the lineup-impact map, every one-for-one and the guided extensions
// on a synthetic league of realistic size. Run: npx tsx scripts/measure-useful-search.ts [teams]
import { bigLeagueFixture } from "../tests/big-league-fixture";
import { evaluate } from "../src/domain/valuation";
import { buildTradeImpactMap } from "../src/domain/trade-impact-map";
import { runUsefulTradeSearch } from "../src/domain/useful-trade-adapter";

const teams = Number(process.argv[2] ?? 12);
const dataset = await bigLeagueFixture(teams);
const m = evaluate(dataset, dataset.settings);
const own = "1";
const ms = (from: number) =>
  `${((performance.now() - from) / 1000).toFixed(2)} s`;

console.log(
  `${teams} teams, ${m.players.length} players, ${m.players.filter((p) => p.owner === own).length} on your roster`,
);
let from = performance.now();
buildTradeImpactMap(m, own, "best-available");
console.log(`impact map: ${ms(from)}`);

// Where one one-for-one's time goes: the shared evaluator alone, against the whole adapter step.
{
  const ours = m.players.filter((p) => p.owner === own).map((p) => p.id);
  const theirs = m.players.filter((p) => p.owner === "2").map((p) => p.id);
  const pairs = ours
    .flatMap((a) => theirs.map((b) => [a, b] as const))
    .slice(0, 200);
  const { evaluateTrade } = await import("../src/domain/trades");
  from = performance.now();
  for (const [a, b] of pairs)
    evaluateTrade(
      m,
      { teamA: own, teamB: "2", give: [a], get: [b] },
      false,
      undefined,
    );
  console.log(
    `evaluateTrade alone: ${((performance.now() - from) / pairs.length).toFixed(2)} ms per one-for-one (${pairs.length} sampled)`,
  );
}
for (const beam of (process.env.BEAMS ?? "50,200,500").split(",").map(Number)) {
  from = performance.now();
  let first = 0;
  const result = await runUsefulTradeSearch(
    m,
    own,
    [],
    "best-available",
    undefined,
    () => {
      first = performance.now() - from;
    },
    beam,
  );
  const c = result.coverage;
  console.log(
    `beam ${beam}: total ${ms(from)}; one-for-ones done at ${(first / 1000).toFixed(2)} s (includes the impact map); ` +
      `${c.singles} one-for-ones, ${c.extensions} extensions evaluated, ${c.beamCutoffs} cut by the beam, ${result.rows.length} rows kept`,
  );
}
