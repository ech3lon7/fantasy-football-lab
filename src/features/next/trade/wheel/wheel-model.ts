import type { TradeFilters } from "../../../../domain/trade-filters";

// What the wheel shows and sets, as plain data. It only reads and writes the trade filter state the list view also uses.

export type Finder = "find" | "chain";
export type CategoryId =
  "gains" | "grades" | "players" | "positions" | "teams" | "size" | "chains" | "never";
export type IconKind = "arrow" | "bars" | "o" | "x" | "oo" | "lines" | "link";

export type OptionKind =
  // One handle on the arc: a single minimum.
  | "slider"
  // Two handles on the arc: a minimum and a maximum, each open at its end of the track.
  | "range"
  // Toggles on the outer arc.
  | "toggles"
  // A search list in the hub.
  | "players"
  // The existing grade-goal editor, opened as a panel.
  | "goals"
  // Which opponents, and only teams graded at or below a position's ceiling.
  | "teamgrade"
  // A category the Chain planner keeps per trade: the wheel points at the per-trade list.
  | "handoff";

export interface WheelOption {
  id: string;
  label: string;
  kind: OptionKind;
  min?: number;
  max?: number;
  step?: number;
  // The hub sentence above the value: "their gain at least".
  hubLine?: string;
  // The filter key whose "hides N" this option shows.
  hides?: string;
}
export interface WheelCategory {
  id: CategoryId;
  label: string;
  icon: IconKind;
  options: WheelOption[];
}

const findCategories: WheelCategory[] = [
  {
    id: "gains",
    label: "Gains",
    icon: "arrow",
    options: [
      {
        id: "yourGain",
        label: "Your EPPG",
        kind: "range",
        min: -3,
        max: 10,
        step: 0.5,
        hubLine: "your gain between",
        hides: "yourGain",
      },
      {
        id: "theirGain",
        label: "Their EPPG",
        kind: "slider",
        min: -2,
        max: 1,
        step: 0.5,
        hubLine: "their gain at least",
        hides: "theirGain",
      },
      {
        id: "ownWeek",
        label: "Your MPPG",
        kind: "range",
        min: -10,
        max: 20,
        step: 1,
        hubLine: "your lineup's MPPG change this week",
        hides: "ownWeek",
      },
      {
        id: "otherWeek",
        label: "Their MPPG",
        kind: "range",
        min: -10,
        max: 20,
        step: 1,
        hubLine: "their lineup's MPPG change this week",
        hides: "otherWeek",
      },
    ],
  },
  {
    id: "grades",
    label: "Grades",
    icon: "bars",
    options: [
      {
        id: "gradeGoals",
        label: "Grade goals",
        kind: "goals",
        hides: "gradeGoals",
      },
    ],
  },
  {
    id: "players",
    label: "Players",
    icon: "o",
    options: [
      { id: "mustGet", label: "I get", kind: "players" },
      { id: "mustGive", label: "I give", kind: "players" },
      { id: "exclude", label: "Exclude", kind: "players", hides: "exclude" },
      { id: "roles", label: "Roles", kind: "toggles" },
    ],
  },
  {
    id: "positions",
    label: "Positions",
    icon: "x",
    options: [
      {
        id: "getPositions",
        label: "I get",
        kind: "toggles",
        hides: "getPositions",
      },
      {
        id: "givePositions",
        label: "I give",
        kind: "toggles",
        hides: "givePositions",
      },
      { id: "labels", label: "Labels", kind: "toggles", hides: "labels" },
    ],
  },
  {
    id: "teams",
    label: "Teams",
    icon: "oo",
    options: [
      { id: "teams", label: "Opponents", kind: "toggles", hides: "teams" },
      {
        id: "teamGrade",
        label: "Graded at or below",
        kind: "teamgrade",
        hides: "teamGrade",
      },
    ],
  },
  {
    id: "size",
    label: "Size",
    icon: "lines",
    options: [
      {
        id: "giveSize",
        label: "Players I give",
        kind: "range",
        min: 1,
        max: 3,
        step: 1,
        hubLine: "I give between",
        hides: "giveSize",
      },
      {
        id: "getSize",
        label: "Players I get",
        kind: "range",
        min: 1,
        max: 3,
        step: 1,
        hubLine: "I get between",
        hides: "getSize",
      },
    ],
  },
];

// The Chain planner adds Chains. Its other categories set the same kinds of thing per trade, so the wheel hands them to the
// per-trade list there (see the hub text of those segments).
const chainsCategory: WheelCategory = {
  id: "chains",
  label: "Chains",
  icon: "link",
  options: [{ id: "sequences", label: "Chain types", kind: "toggles" }],
};

// The ring follows the Playbook board, clockwise from the top: Gains, Players, Positions, Teams, Size, Grades.
const ringOrder: CategoryId[] = [
  "gains",
  "players",
  "positions",
  "teams",
  "size",
  "grades",
];
const inRingOrder = (list: WheelCategory[]) =>
  [...list].sort((a, b) => ringOrder.indexOf(a.id) - ringOrder.indexOf(b.id));

// On the Chain planner the single-trade filters are set per trade, so those segments point at the per-trade list; Gains carries
// Their EPPG, Teams the opponents searched, and Chains the types of sequence.
const perTrade: WheelOption = {
  id: "perTrade",
  label: "Per trade",
  kind: "handoff",
};
const chainCategories = (): WheelCategory[] =>
  inRingOrder(findCategories).map((c) =>
    c.id === "gains"
      ? { ...c, options: [c.options[1]] }
      : c.id === "teams"
        ? {
            ...c,
            options: [
              {
                id: "chainTeams",
                label: "Opponents",
                kind: "toggles" as const,
              },
            ],
          }
        : { ...c, options: [perTrade] },
  );

export const categoriesFor = (finder: Finder): WheelCategory[] =>
  finder === "chain"
    ? [...chainCategories(), chainsCategory]
    : inRingOrder(findCategories);

export const formatGain = (value: number) =>
  value > 0 ? `+${value}` : String(value);

const isRangeSet = (r: { minimum: number | null; maximum: number | null }) =>
  r.minimum !== null || r.maximum !== null;

// How many filters of a category differ from their defaults. The defaults are your gain at least 0 and their gain at least +1.
export function categoryActive(f: TradeFilters, id: CategoryId): number {
  switch (id) {
    case "gains":
      return (
        Number(f.yourGain.minimum !== 0 || f.yourGain.maximum !== null) +
        Number(f.theirGain !== 1) +
        Number(isRangeSet(f.ownWeek)) +
        Number(isRangeSet(f.otherWeek))
      );
    case "grades":
      return Number(f.gradeGoals.length > 0);
    case "players":
      return (
        Number(f.mustGet.length > 0) +
        Number(f.mustGive.length > 0) +
        Number(f.exclude.length > 0) +
        Number(f.receiveStarts) +
        Number(f.giveStarts)
      );
    case "positions":
      return (
        Number(f.getPositions.length > 0) +
        Number(f.givePositions.length > 0) +
        Number(f.labels.length > 0)
      );
    case "teams":
      return Number(f.teams !== null) + Number(f.teamGrade !== null);
    case "size":
      return (
        Number(f.giveSize.minimum !== 1 || f.giveSize.maximum !== 3) +
        Number(f.getSize.minimum !== 1 || f.getSize.maximum !== 3)
      );
    default:
      return 0;
  }
}

export const activeFilterCount = (f: TradeFilters) =>
  (
    ["gains", "grades", "players", "positions", "teams", "size"] as const
  ).reduce((n, id) => n + categoryActive(f, id), 0);

const plural = (n: number, word: string) => `${n} ${word}`;

// One line for the hub under the category name: the current setting in words.
export function hubSummary(f: TradeFilters, id: CategoryId): string {
  switch (id) {
    case "gains":
      return `Their EPPG at least ${formatGain(f.theirGain)}`;
    case "grades":
      return f.gradeGoals.length
        ? plural(
            f.gradeGoals.length,
            f.gradeGoals.length === 1 ? "grade goal" : "grade goals",
          )
        : "No grade goals";
    case "players": {
      const getSummary = f.mustGet.length
        ? (f.mustGetRequired?.length ? `${f.mustGet.length} wanted · ${f.mustGetRequired.length} required` : `${f.mustGet.length} wanted`)
        : null;
      const giveSummary = f.mustGive.length
        ? (f.mustGiveRequired?.length ? `${f.mustGive.length} offered · ${f.mustGiveRequired.length} required` : `${f.mustGive.length} offered`)
        : null;
      const excludeSummary = f.exclude.length ? `${f.exclude.length} excluded` : null;
      const parts = [getSummary, giveSummary, excludeSummary].filter(Boolean);
      return parts.length ? parts.join(" · ") : "Any players";
    }
    case "mustGet" as CategoryId:
      return f.mustGetRequired?.length
        ? `${f.mustGet.length} wanted · ${f.mustGetRequired.length} required`
        : `${f.mustGet.length} wanted`;
    case "mustGive" as CategoryId:
      return f.mustGiveRequired?.length
        ? `${f.mustGive.length} offered · ${f.mustGiveRequired.length} required`
        : `${f.mustGive.length} offered`;
    case "positions":
      return f.getPositions.length || f.givePositions.length
        ? [
            f.getPositions.length && `get ${f.getPositions.join(", ")}`,
            f.givePositions.length && `give ${f.givePositions.join(", ")}`,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Any position";
    case "teams":
      return f.teams === null
        ? "All teams"
        : plural(f.teams.length, f.teams.length === 1 ? "team" : "teams");
    case "size":
      return `Give ${f.giveSize.minimum ?? 1}–${f.giveSize.maximum ?? 3} · get ${f.getSize.minimum ?? 1}–${f.getSize.maximum ?? 3}`;
    default:
      return "";
  }
}

// A two-handle range shows an open end at the end of the track, and writes an end handle back as no limit.
export function rangeValue(
  value: number | null,
  min: number,
  max: number,
  end: "min" | "max",
) {
  return value === null ? (end === "min" ? min : max) : value;
}
export function rangeToFilter(
  value: number,
  min: number,
  max: number,
  end: "min" | "max",
) {
  return (end === "min" ? value <= min : value >= max) ? null : value;
}
