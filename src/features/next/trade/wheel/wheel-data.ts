import { positions, str } from "../../../../domain/contracts";
import type { PositionalGradeImpactRule } from "../../../../domain/chain-position-impact";
import {
  clampTheirGain,
  type TradeFilters,
} from "../../../../domain/trade-filters";
import type { Model, Player } from "../../../../domain/valuation";
import {
  activeFilterCount,
  categoriesFor,
  categoryActive,
  hubSummary,
  rangeToFilter,
  rangeValue,
  type CategoryId,
  type Finder,
  type WheelCategory,
} from "./wheel-model";

export interface WheelToggle {
  key: string;
  label: string;
  on: boolean;
}

// Everything the wheel reads and writes. It is only a view of the filter state; nothing here is stored anywhere else.
export interface WheelData {
  finder: Finder;
  categories: WheelCategory[];
  active: (id: CategoryId) => number;
  activeCount: number;
  summary: (id: CategoryId) => string;
  getNumber: (optionId: string) => { lo: number | null; hi: number | null };
  setNumber: (optionId: string, lo: number | null, hi: number | null) => void;
  getToggles: (optionId: string) => WheelToggle[];
  setToggle: (optionId: string, key: string, on: boolean) => void;
  getPlayers: (optionId: string) => { players: Player[]; selected: string[] };
  togglePlayer: (optionId: string, id: string) => void;
  teamGrade: TradeFilters["teamGrade"];
  setTeamGrade: (value: TradeFilters["teamGrade"]) => void;
  goals: PositionalGradeImpactRule[];
  setGoals: (goals: PositionalGradeImpactRule[]) => void;
  // How many trades each filter alone hides, the shown and total counts from the worker.
  hides: Record<string, number>;
  total: number;
  visible: number;
  clear: () => void;
  // What Clear all removes, so its Undo can put it back.
  snapshot: () => unknown;
  restore: (snapshot: unknown) => void;
}

const toggle = (items: string[], key: string, on: boolean) =>
  on
    ? items.includes(key)
      ? items
      : [...items, key]
    : items.filter((x) => x !== key);
const RANGES: Record<
  string,
  { min: number; max: number; key: "yourGain" | "ownWeek" | "otherWeek" }
> = {
  yourGain: { min: -3, max: 10, key: "yourGain" },
  ownWeek: { min: -10, max: 20, key: "ownWeek" },
  otherWeek: { min: -10, max: 20, key: "otherWeek" },
};

// The Find trades adapter: each wheel option is one field of the trade filters the list view edits.
export function findWheelData({
  m,
  teamA,
  filters: f,
  update,
  clear,
  counts,
}: {
  m: Model;
  teamA: string;
  filters: TradeFilters;
  update: (patch: Partial<TradeFilters>) => void;
  clear: () => void;
  counts: { total: number; visible: number; hides: Record<string, number> };
}): WheelData {
  const mine = m.players.filter((p) => p.owner === teamA);
  const theirs = m.players.filter((p) => p.owner !== "0" && p.owner !== teamA);
  const opponents = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== teamA,
  );
  const opponentIds = opponents.map((t) => str(t.TeamID));
  return {
    finder: "find",
    categories: categoriesFor("find"),
    active: (id) => categoryActive(f, id),
    activeCount: activeFilterCount(f),
    summary: (id) => hubSummary(f, id),
    getNumber(id) {
      if (id === "theirGain") return { lo: f.theirGain, hi: null };
      if (id === "giveSize")
        return { lo: f.giveSize.minimum ?? 1, hi: f.giveSize.maximum ?? 3 };
      if (id === "getSize")
        return { lo: f.getSize.minimum ?? 1, hi: f.getSize.maximum ?? 3 };
      const r = RANGES[id];
      return {
        lo: rangeValue(f[r.key].minimum, r.min, r.max, "min"),
        hi: rangeValue(f[r.key].maximum, r.min, r.max, "max"),
      };
    },
    setNumber(id, lo, hi) {
      if (id === "theirGain")
        return update({ theirGain: clampTheirGain(lo ?? 1) });
      if (id === "giveSize" || id === "getSize") {
        const key = id;
        return update({
          [key]: { minimum: lo ?? 1, maximum: hi ?? 3 },
        } as Partial<TradeFilters>);
      }
      const r = RANGES[id];
      update({
        [r.key]: {
          minimum: rangeToFilter(lo ?? r.min, r.min, r.max, "min"),
          maximum: rangeToFilter(hi ?? r.max, r.min, r.max, "max"),
        },
      } as Partial<TradeFilters>);
    },
    getToggles(id) {
      if (id === "getPositions")
        return positions.map((p) => ({
          key: p,
          label: p,
          on: f.getPositions.includes(p),
        }));
      if (id === "givePositions")
        return positions.map((p) => ({
          key: p,
          label: p,
          on: f.givePositions.includes(p),
        }));
      if (id === "labels")
        return (["Gem", "Pre-gem", "Watch"] as const).map((l) => ({
          key: l,
          label: l,
          on: f.labels.includes(l),
        }));
      if (id === "teams")
        return opponents.map((t) => ({
          key: str(t.TeamID),
          label: str(t.TeamName),
          on: f.teams === null || f.teams.includes(str(t.TeamID)),
        }));
      if (id === "roles")
        return [
          {
            key: "receiveStarts",
            label: "Everyone I receive starts for me",
            on: f.receiveStarts,
          },
          {
            key: "giveStarts",
            label: "Everyone I send starts for them",
            on: f.giveStarts,
          },
        ];
      return [];
    },
    setToggle(id, key, on) {
      if (id === "getPositions")
        return update({
          getPositions: toggle(
            f.getPositions as string[],
            key,
            on,
          ) as TradeFilters["getPositions"],
        });
      if (id === "givePositions")
        return update({ givePositions: toggle(f.givePositions, key, on) });
      if (id === "labels")
        return update({
          labels: toggle(
            f.labels as string[],
            key,
            on,
          ) as TradeFilters["labels"],
        });
      if (id === "roles") return update({ [key]: on } as Partial<TradeFilters>);
      if (id === "teams") {
        const selected = f.teams ?? opponentIds;
        const next = on
          ? [...new Set([...selected, key])]
          : selected.filter((v) => v !== key);
        update({ teams: next.length === opponentIds.length ? null : next });
      }
    },
    getPlayers(id) {
      if (id === "mustGet") return { players: theirs, selected: f.mustGet };
      if (id === "mustGive") return { players: mine, selected: f.mustGive };
      return { players: [...mine, ...theirs], selected: f.exclude };
    },
    togglePlayer(id, playerId) {
      const key = id as "mustGet" | "mustGive" | "exclude";
      const list = f[key];
      update({
        [key]: list.includes(playerId)
          ? list.filter((x) => x !== playerId)
          : [...list, playerId],
      } as Partial<TradeFilters>);
    },
    teamGrade: f.teamGrade,
    setTeamGrade: (teamGrade) => update({ teamGrade }),
    goals: f.gradeGoals,
    setGoals: (gradeGoals) => update({ gradeGoals }),
    hides: counts.hides,
    total: counts.total,
    visible: counts.visible,
    clear,
    snapshot: () => f,
    restore: (snapshot) => update(snapshot as TradeFilters),
  };
}

// The Chain planner adapter: Their EPPG is its recipient minimum, Teams the opponents it searches, Chains the sequence types.
// Everything else is set per trade, so those categories point at the per-trade list.
export function chainWheelData({
  m,
  own,
  theirGain,
  setTheirGain,
  selectedTeams,
  setSelectedTeams,
  sequences,
  setSequences,
  counts,
  clear,
  snapshot,
  restore,
}: {
  m: Model;
  own: string;
  theirGain: number;
  setTheirGain: (value: number) => void;
  selectedTeams: string[] | undefined;
  setSelectedTeams: (teams: string[] | undefined) => void;
  sequences: "connected" | "sequential" | "both";
  setSequences: (value: "connected" | "sequential" | "both") => void;
  counts: { total: number; visible: number };
  clear: () => void;
  snapshot: () => unknown;
  restore: (snapshot: unknown) => void;
}): WheelData {
  const opponents = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== own,
  );
  const ids = opponents.map((t) => str(t.TeamID));
  const types = () => ({
    connected: sequences !== "sequential",
    sequential: sequences !== "connected",
  });
  const kind = (t: {
    connected: boolean;
    sequential: boolean;
  }): "connected" | "sequential" | "both" =>
    t.connected && t.sequential
      ? "both"
      : t.sequential
        ? "sequential"
        : "connected";
  const categories = categoriesFor("chain");
  const active = (id: CategoryId) =>
    id === "gains"
      ? Number(theirGain !== 1)
      : id === "teams"
        ? Number(selectedTeams !== undefined)
        : id === "chains"
          ? Number(sequences !== "connected")
          : 0;
  return {
    finder: "chain",
    categories,
    active,
    activeCount: (["gains", "teams", "chains"] as const).reduce(
      (n, id) => n + active(id),
      0,
    ),
    summary: (id) =>
      id === "gains"
        ? `Their EPPG at least ${theirGain > 0 ? `+${theirGain}` : theirGain}`
        : id === "teams"
          ? selectedTeams === undefined
            ? "All teams"
            : `${selectedTeams.length} teams`
          : id === "chains"
            ? sequences === "both"
              ? "Both types"
              : sequences === "connected"
                ? "Connected chains"
                : "Sequential upgrades"
            : "Set per trade",
    getNumber: () => ({ lo: theirGain, hi: null }),
    setNumber: (_id, lo) => setTheirGain(clampTheirGain(lo ?? 1)),
    getToggles(id) {
      if (id === "chainTeams")
        return opponents.map((t) => ({
          key: str(t.TeamID),
          label: str(t.TeamName),
          on:
            selectedTeams === undefined ||
            selectedTeams.includes(str(t.TeamID)),
        }));
      if (id === "sequences")
        return [
          { key: "connected", label: "Connected", on: types().connected },
          { key: "sequential", label: "Sequential", on: types().sequential },
        ];
      return [];
    },
    setToggle(id, key, on) {
      if (id === "chainTeams") {
        const current = selectedTeams ?? ids;
        const next = on
          ? [...new Set([...current, key])]
          : current.filter((v) => v !== key);
        setSelectedTeams(next.length === ids.length ? undefined : next);
      } else if (id === "sequences") {
        const next = { ...types(), [key]: on };
        // At least one type stays on.
        if (next.connected || next.sequential) setSequences(kind(next));
      }
    },
    getPlayers: () => ({ players: [], selected: [] }),
    togglePlayer: () => {},
    teamGrade: null,
    setTeamGrade: () => {},
    goals: [],
    setGoals: () => {},
    hides: {},
    total: counts.total,
    visible: counts.visible,
    clear,
    snapshot,
    restore,
  };
}
