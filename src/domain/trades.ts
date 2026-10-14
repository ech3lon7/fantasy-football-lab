import { type Model } from "./valuation";
import { type Draft, sum } from "./contracts";
import {
  roster,
  makeLegal,
  fillRoster,
  horizon,
  irAssignments,
  rosterExcess,
} from "./lineups";
export function dealGrade(outgoing: number, incoming: number, m: Model) {
  const s = m.settings;
  if (outgoing === 0)
    return incoming === 0
      ? "Not distinguishable above replacement"
      : "Positive surplus for zero outgoing surplus";
  const gap = (incoming - outgoing) / outgoing;
  return gap <= -s.HorribleLossPct
    ? "Horrible deal"
    : gap <= -s.BadLossPct
      ? "Bad deal"
      : gap < -s.FairBandPct
        ? "Less than ideal"
        : gap <= s.FairBandPct
          ? "Fair deal"
          : gap < s.ExcellentPct
            ? "Good deal"
            : gap < s.StealPct
              ? "Excellent deal"
              : "Steal deal";
}
export function evaluateTrade(m: Model, d: Draft, withWaivers = true) {
  const errors: string[] = [];
  if (!d.teamA || !d.teamB || d.teamA === d.teamB)
    errors.push("Choose two different teams.");
  if (!d.give.length || !d.get.length || d.give.length > 5 || d.get.length > 5)
    errors.push("Select one to five players on each side.");
  const selected = [...d.give, ...d.get];
  if (new Set(selected).size !== selected.length)
    errors.push("Duplicate player selected.");
  for (const [ids, owner] of [
    [d.give, d.teamA],
    [d.get, d.teamB],
  ] as const)
    if (ids.some((id) => m.byId.get(id)?.owner !== owner))
      errors.push("Selected players must belong to the selected team.");
  if (!m.weeks.length) errors.push("The fantasy scoring horizon is complete.");
  if (selected.some((id) => m.byId.get(id)?.value === null))
    errors.push("Incomplete model data for a selected player.");
  if (errors.length) return { valid: false as const, errors };
  const initialA = roster(m, d.teamA),
    initialB = roster(m, d.teamB),
    a = makeLegal(m, [
      ...initialA.filter((id) => !d.give.includes(id)),
      ...d.get,
    ]),
    b = makeLegal(m, [
      ...initialB.filter((id) => !d.get.includes(id)),
      ...d.give,
    ]);
  const postA = withWaivers
      ? fillRoster(m, a.ids, b.ids)
      : { ids: a.ids, adds: [] },
    postB = withWaivers
      ? fillRoster(m, b.ids, postA.ids)
      : { ids: b.ids, adds: [] };
  const affected = [...selected, ...a.drops, ...b.drops].map((id) =>
      m.byId.get(id)!,
    ),
    missing = affected.some((p) => p.baseline === null),
    thin = affected.some((p) => p.baselineStatus !== "Available");
  const valueMissing = selected.some((id) => m.byId.get(id)?.value === null),
    outgoing = sum(d.give.map((id) => m.byId.get(id)?.positive ?? 0)),
    incoming = sum(d.get.map((id) => m.byId.get(id)?.positive ?? 0)),
    advantage = outgoing > 0 ? (incoming - outgoing) / outgoing : null;
  const equal = d.give.length === d.get.length,
    small = d.give.length < d.get.length ? d.give : d.get,
    large = d.give.length < d.get.length ? d.get : d.give,
    premium = m.settings.Premium,
    ros = (ids: string[]) =>
      sum(
        ids.map((id) => {
          const p = m.byId.get(id)!;
          return (p.value ?? 0) * p.available;
        }),
      ),
    surplus = (ids: string[]) =>
      sum(ids.map((id) => m.byId.get(id)?.positive ?? 0));
  const dropCost = sum(
      (d.get.length > d.give.length ? a.drops : b.drops).map((id) => {
        const p = m.byId.get(id)!;
        return Math.max(0, p.baseline ?? 0) * p.available;
      }),
    ),
    requiredSurplus = equal ? outgoing : surplus(small) * (1 + premium),
    actualSurplus = equal ? incoming : surplus(large),
    requiredPoints = equal
      ? ros(d.give)
      : ros(small) * (1 + premium) + dropCost,
    actualPoints = equal ? ros(d.get) : ros(large);
  const uncertainty: string[] = [];
  if (missing) uncertainty.push("Replacement baseline unavailable");
  else if (thin) uncertainty.push("Thin replacement pool");
  if (valueMissing) uncertainty.push("Selected player value unavailable");
  if (
    [...new Set([...postA.ids, ...postB.ids, ...selected])].some(
      (id) => m.byId.get(id)?.uncertain,
    )
  )
    uncertainty.push("Injury availability");
  if (
    !m.dataset.sourceUTC ||
    Date.now() - Date.parse(m.dataset.sourceUTC) > 86400000
  )
    uncertainty.push("Stale or unavailable source timestamp");
  if (m.dataset.issues.length) uncertainty.push("Source data warnings");
  function impact(before: string[], after: string[], post: string[]) {
    const pre = horizon(m, before),
      trade = horizon(m, after),
      waiver = horizon(m, post),
      downPre = horizon(m, before, true),
      downPost = horizon(m, after, true);
    const weekly = pre.map((l, i) => ({
      week: l.week,
      beforeExpected: l.expected,
      afterExpected: trade[i].expected,
      expectedGain: trade[i].expected - l.expected,
      beforeValue: l.value,
      afterValue: trade[i].value,
      valueGain: trade[i].value - l.value,
      waiverExpectedGain: waiver[i].expected - trade[i].expected,
      waiverValueGain: waiver[i].value - trade[i].value,
      downside: downPost[i].value - downPre[i].value,
      unfilled: trade[i].unfilled,
      ids: trade[i].ids,
      slots: trade[i].slots,
    }));
    return {
      weekly,
      expected: sum(weekly.map((w) => w.expectedGain)),
      value: sum(weekly.map((w) => w.valueGain)),
      expectedPerWeek: sum(weekly.map((w) => w.expectedGain)) / m.weeks.length,
      valuePerWeek: sum(weekly.map((w) => w.valueGain)) / m.weeks.length,
      waiverExpected: sum(weekly.map((w) => w.waiverExpectedGain)),
      waiverValue: sum(weekly.map((w) => w.waiverValueGain)),
      downside: sum(weekly.map((w) => w.downside)),
    };
  }
  const legality =
    a.excess +
      b.excess +
      rosterExcess(m, postA.ids) +
      rosterExcess(m, postB.ids) ===
    0;
  return {
    valid: true as const,
    errors,
    grade:
      missing || valueMissing
        ? "UNAVAILABLE - missing valuation"
        : dealGrade(outgoing, incoming, m),
    outgoing,
    incoming,
    advantage,
    difference: incoming - outgoing,
    neededEven: Math.max(0, outgoing - incoming),
    neededFair: Math.max(0, outgoing * (1 - m.settings.FairBandPct) - incoming),
    requiredSurplus,
    actualSurplus,
    surplusTest:
      missing || valueMissing
        ? "UNAVAILABLE"
        : actualSurplus >= requiredSurplus
          ? "PASS"
          : "FAIL",
    surplusShortfall: Math.max(0, requiredSurplus - actualSurplus),
    requiredPoints,
    actualPoints,
    pointsTest:
      missing || valueMissing
        ? "UNAVAILABLE"
        : actualPoints >= requiredPoints
          ? "PASS"
          : "FAIL",
    pointsShortfall: Math.max(0, requiredPoints - actualPoints),
    dropCost,
    legality,
    uncertainty,
    initialA,
    initialB,
    legalA: a.ids,
    legalB: b.ids,
    postA: postA.ids,
    postB: postB.ids,
    dropsA: a.drops,
    dropsB: b.drops,
    addsA: postA.adds,
    addsB: postB.adds,
    irA: irAssignments(m, a.ids),
    irB: irAssignments(m, b.ids),
    a: impact(initialA, a.ids, postA.ids),
    b: impact(initialB, b.ids, postB.ids),
  };
}
export type TradeResult = ReturnType<typeof evaluateTrade>;
