import type {
  GradeImpactSide,
  GradeImpactType,
  PositionalGradeImpactRule,
} from "../../../domain/chain-position-impact";

// The step choices of a positional grade goal, with the plain label each one carries.
export interface StepOption {
  key: string;
  type: GradeImpactType;
  steps: number;
  label: string;
}

const upgrades = (): StepOption[] =>
  [5, 4, 3, 2, 1].map((n) => ({
    key: String(n),
    type: "upgrade",
    steps: n,
    label: `Upgrade ≥ ${n} step${n === 1 ? "" : "s"}`,
  }));

const drops = (side: "own" | "other"): StepOption[] =>
  [0, -1, -2, -3, -4, -5].map((n) => ({
    key: side === "other" && n < 0 ? `limit:${n}` : String(n),
    type: "drop_limit",
    steps: n,
    label:
      n === 0
        ? side === "own"
          ? "No drop (≥ 0)"
          : "No drop for them (≥ 0)"
        : `Drop at most ${-n} step${n === -1 ? "" : "s"}`,
  }));

// Your team: improve, or limit how far a position may fall.
export const ownStepOptions: StepOption[] = [...upgrades(), ...drops("own")];

// Their team: the same, plus goals that deplete them.
export const otherStepOptions: StepOption[] = [
  ...upgrades(),
  ...drops("other"),
  ...[-1, -2, -3, -4, -5].map((n): StepOption => ({
    key: String(n),
    type: "deplete",
    steps: n,
    label: `Downgrade by ≥ ${-n} step${n === -1 ? "" : "s"}`,
  })),
];

// Their overall steps may be tied to yours.
export const matchNetOption: StepOption = {
  key: "match_net",
  type: "match_net",
  steps: 0,
  label: "Match your overall steps",
};

export const isOverall = (position: string) =>
  position.toUpperCase() === "OVERALL";

// The step choices a rule offers, given its side and position.
export function stepOptionsFor(rule: PositionalGradeImpactRule): StepOption[] {
  if (rule.side === "own") return ownStepOptions;
  return isOverall(rule.position)
    ? [matchNetOption, ...otherStepOptions]
    : otherStepOptions;
}

// The key of the option a rule currently matches.
export function goalKey(rule: PositionalGradeImpactRule): string {
  if (rule.type === "match_net") return "match_net";
  if (rule.side === "other" && rule.type === "drop_limit" && rule.steps < 0)
    return `limit:${rule.steps}`;
  return String(rule.steps);
}

// A new goal: your first position without one, asking for two steps of improvement.
export function newGoal(
  rules: PositionalGradeImpactRule[],
  positions: string[],
): PositionalGradeImpactRule {
  const taken = new Set(
    rules.filter((r) => r.side === "own").map((r) => r.position),
  );
  const all = positions.some(isOverall) ? positions : [...positions, "OVERALL"];
  return {
    id: crypto.randomUUID(),
    side: "own",
    position: all.find((p) => !taken.has(p)) ?? all[0] ?? "WR",
    type: "upgrade",
    steps: 2,
  };
}

// Changing the team or position can invalidate the step choice; fall back to a sensible one instead of keeping an impossible goal.
export function withSide(
  rule: PositionalGradeImpactRule,
  side: GradeImpactSide,
): PositionalGradeImpactRule {
  if (side === "own" && rule.type === "match_net")
    return { ...rule, side, type: "upgrade", steps: 2 };
  return { ...rule, side };
}

export function withPosition(
  rule: PositionalGradeImpactRule,
  position: string,
): PositionalGradeImpactRule {
  if (rule.type === "match_net" && !isOverall(position))
    return { ...rule, position, type: "upgrade", steps: 1 };
  return { ...rule, position };
}

// Apply a chosen step option to a rule, carrying its type.
export function withStepKey(
  rule: PositionalGradeImpactRule,
  key: string,
): PositionalGradeImpactRule {
  const options = stepOptionsFor(rule);
  const selected =
    options.find((o) => o.key === key) ??
    options.find((o) => o.steps === Number(key));
  return selected
    ? { ...rule, steps: selected.steps, type: selected.type }
    : rule;
}

// One line for the group summary: "Your WR +2 · their RB no worse than −1", or the empty text.
export function goalsSummary(rules: PositionalGradeImpactRule[]): string {
  if (!rules.length) return "None";
  const part = (r: PositionalGradeImpactRule) => {
    const who = r.side === "own" ? "Your" : "their";
    const at = isOverall(r.position) ? "overall" : r.position;
    if (r.type === "match_net") return `${who} ${at} matches yours`;
    if (r.type === "drop_limit")
      return r.steps === 0
        ? `${who} ${at} no drop`
        : `${who} ${at} no worse than −${-r.steps}`;
    if (r.type === "deplete") return `${who} ${at} down ${-r.steps}+`;
    return `${who} ${at} +${r.steps}`;
  };
  return rules.map(part).join(" · ");
}
