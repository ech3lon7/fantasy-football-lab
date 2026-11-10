import { str } from "../contracts";
import { nextRefreshContext, nextRefreshDefaults } from "../next-refresh";
import { playedHistory } from "../opportunity";
import {
  calculateLeagueAverageVolume,
  calculatePlayerTrend,
  type PlayerTrendSummary,
} from "../player-trend";
import { playerSignals, type Model, type Player } from "../valuation";
import { teamColors } from "./nfl-colors";

// Format a number for display, keeping unavailable values null so the interface can show a quiet dash.
const f = (x: number | null, digits = 1): string | null =>
  x === null || !Number.isFinite(x) ? null : x.toFixed(digits);

export type Provenance = "fact" | "espn" | "model";

export interface NumberItem {
  label: string;
  provenance: Provenance;
  value: number | null;
  display: string | null;
  // Why the value is missing; empty when it is available.
  reason: string;
}

export interface RadarAxis {
  key: string;
  label: string;
  value: number | null;
  average: number | null;
  // Position of the value and of the position average on a 0 to 1 scale; the average always sits at 0.5.
  scaled: number | null;
  scaledAverage: number;
}

export interface CalcStep {
  label: string;
  display: string | null;
  note: string;
}

export interface PlayerCard {
  id: string;
  header: {
    name: string;
    pos: string;
    nfl: string;
    owner: string;
    injury: string;
    colors: { background: string; ink: string };
    labels: string[];
    eppg: string | null;
    floor: string | null;
    ceiling: string | null;
    spread: string | null;
    rangeReason: string;
    // For example "64% this player's games · 36% WR history"; null when no positional reference applies.
    blendLine: string | null;
    recent: string | null;
    surplus: string | null;
  };
  story: string[];
  numbers: {
    groups: { provenance: Provenance; title: string; items: NumberItem[] }[];
    unavailable: NumberItem[];
  };
  radar: RadarAxis[];
  chart: { trend: PlayerTrendSummary; leagueAvgVolume: number };
  calculation: CalcStep[];
  status: string;
}

const groupTitles: Record<Provenance, string> = {
  fact: "Recorded facts",
  espn: "ESPN projections",
  model: "Model outputs",
};

// Build one number row; a missing value carries its reason instead of showing zero.
function item(
  label: string,
  provenance: Provenance,
  value: number | null,
  reason: string,
  digits = 1,
): NumberItem {
  const display = f(value, digits);
  return {
    label,
    provenance,
    value,
    display,
    reason: display === null ? reason : "",
  };
}

// Axes compare the player with the mean of every player at the same position that has the value.
function radarAxes(m: Model, p: Player): RadarAxis[] {
  const defs: [string, string, (x: Player) => number | null][] = [
    ["recent", "Recent PPG", (x) => x.recent],
    ["expected", "Expected PPG", (x) => x.blendedExpected],
    ["value", "Value PPG", (x) => x.value],
    ["index", "Surplus index", (x) => x.index],
    ["workload", "Opportunities / game", (x) => x.opportunity.recentRate],
    ["snaps", "Snap share", (x) => x.opportunity.snapShare],
  ];
  const peers = m.players.filter((x) => x.pos === p.pos);
  return defs.map(([key, label, read]) => {
    const own = read(p);
    const values = peers
      .map(read)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const average = values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
    // Twice the average reaches the edge of the chart; an average of zero or less cannot anchor a scale.
    const scaled =
      own === null || average === null || average <= 0
        ? null
        : Math.min(1, Math.max(0, own / (2 * average)));
    return { key, label, value: own, average, scaled, scaledAverage: 0.5 };
  });
}

// Everything the player card shows, computed from model results; null when the player is not in the snapshot.
export function playerCard(m: Model, id: string): PlayerCard | null {
  const p = m.byId.get(id);
  if (!p) return null;
  const owner =
    p.owner === "0"
      ? "Available / waivers"
      : str(
          m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === p.owner)
            ?.TeamName,
        ) || "Unknown team";
  const defaults = nextRefreshDefaults(m, p);
  const context = nextRefreshContext(m, p);
  const rows = playedHistory(m.dataset).get(p.id) ?? [];
  const trend = calculatePlayerTrend(rows, p.pos, p.projected);
  const labels = playerSignals(p).filter(
    (x) => x && !/^(none|no |—|n\.a\.)/i.test(x),
  );
  const noGames = "No completed games in this snapshot.";
  const noProjection = "ESPN has not published this projection.";
  const roleSource = p.opportunity.supplementalStatus || "Source not imported.";
  const items = {
    fact: [
      item("Actual season PPG", "fact", p.actual, noGames, 2),
      item("Recent PPG (last 3)", "fact", p.recent, noGames, 2),
      item("Games played", "fact", p.games, noGames, 0),
      item(
        "Scoring variability (sample SD)",
        "fact",
        p.scoringSD,
        "At least two played games are needed.",
        2,
      ),
      item(
        "Recent opportunities / game",
        "fact",
        p.opportunity.recentRate,
        roleSource,
        1,
      ),
      item(
        "Earlier opportunities / game",
        "fact",
        p.opportunity.priorRate,
        roleSource,
        1,
      ),
      item(
        "Recent snap share",
        "fact",
        p.opportunity.snapShare === null ? null : p.opportunity.snapShare * 100,
        roleSource,
        0,
      ),
      item(
        "Red-zone targets / game",
        "fact",
        p.opportunity.redZoneTargets,
        roleSource,
        1,
      ),
    ],
    espn: [
      item("ESPN season PPG", "espn", p.projected, noProjection, 2),
      item(`ESPN Week ${m.current}`, "espn", p.weekly, noProjection, 2),
    ],
    model: [
      item("Expected PPG", "model", p.blendedExpected, p.status, 2),
      item("Value PPG", "model", p.value, p.status, 2),
      item("Surplus index", "model", p.index, p.baselineStatus, 1),
      item("VORP through final week", "model", p.vorp, p.baselineStatus, 1),
      item("Replacement Value PPG", "model", p.baseline, p.baselineStatus, 2),
    ],
  } as const;
  const all = [...items.fact, ...items.espn, ...items.model];
  const groups = (["fact", "espn", "model"] as const).map((provenance) => ({
    provenance,
    title: groupTitles[provenance],
    // Available values only; missing ones are listed once, with reasons, under "unavailable".
    items: items[provenance].filter((x) => x.display !== null),
  }));
  const story: string[] = [];
  if (p.blendedExpected !== null) {
    const parts = [
      p.actual !== null ? `${f(p.actual, 2)} actual` : null,
      p.projected !== null ? `${f(p.projected, 2)} ESPN season` : null,
    ].filter(Boolean);
    story.push(
      `Expected PPG is ${f(p.blendedExpected, 2)}${parts.length ? `, blending ${parts.join(" and ")} PPG` : ""}.`,
    );
  }
  if (defaults.lower !== null && defaults.higher !== null)
    story.push(
      `The next-game range runs from a floor of ${f(defaults.lower)} to a ceiling of ${f(defaults.higher)} points.`,
    );
  if (p.recent !== null && p.actual !== null) {
    const gap = p.recent - p.actual;
    story.push(
      `The last three games average ${f(p.recent, 2)}, ${Math.abs(gap) < 0.05 ? "level with" : `${f(Math.abs(gap), 2)} ${gap > 0 ? "above" : "below"}`} the season average of ${f(p.actual, 2)}.`,
    );
  }
  if (p.opportunity.recentRate !== null && p.opportunity.priorRate !== null)
    story.push(
      `Recent workload is ${f(p.opportunity.recentRate)} opportunities per game versus ${f(p.opportunity.priorRate)} earlier.`,
    );
  if (labels.length) story.push(`Active labels: ${labels.join(", ")}.`);
  if (p.uncertain) story.push("Availability is conditional.");
  return {
    id: p.id,
    header: {
      name: p.name,
      pos: p.pos,
      nfl: p.nfl,
      owner,
      injury: p.injury,
      colors: teamColors(p.nfl),
      labels,
      eppg: f(p.blendedExpected, 1),
      floor: f(defaults.lower),
      ceiling: f(defaults.higher),
      spread: f(defaults.spread, 1),
      blendLine: defaults.reference
        ? `${Math.round(defaults.personalWeight * 100)}% this player's games · ${Math.round((1 - defaults.personalWeight) * 100)}% ${p.pos} history`
        : null,
      rangeReason:
        defaults.lower === null
          ? context.issue || "Needs a usable EPPG and scoring variability."
          : "",
      recent: f(p.recent),
      surplus: f(p.index, 0),
    },
    story,
    numbers: { groups, unavailable: all.filter((x) => x.display === null) },
    radar: radarAxes(m, p),
    chart: {
      trend,
      leagueAvgVolume: calculateLeagueAverageVolume(
        m.dataset.tables.ModelHistory,
        m.dataset.tables.ModelPlayers,
        p.pos,
      ),
    },
    calculation: [
      {
        label: "Actual PPG",
        display: f(p.actual, 2),
        note: "Completed played-game points divided by games played.",
      },
      {
        label: "Recent PPG",
        display: f(p.recent, 2),
        note: "Mean of the latest three played games.",
      },
      {
        label: "Observed PPG",
        display: f(p.observed, 2),
        note: "A weighted blend of actual and recent PPG.",
      },
      {
        label: "Actual-results weight",
        display: f(p.weight, 2),
        note: "Grows with games played; the rest goes to ESPN's season projection.",
      },
      {
        label: "ESPN season PPG",
        display: f(p.projected, 2),
        note: "Held fixed; ESPN may update it.",
      },
      {
        label: "Expected PPG",
        display: f(p.blendedExpected, 2),
        note: "Observed PPG blended with the ESPN season projection.",
      },
      {
        label: "Consistency loss",
        display: f(p.penalty, 2),
        note: "A deduction for scoring variability, applied after four played games.",
      },
      {
        label: "Value PPG",
        display: f(p.value, 2),
        note: "Expected PPG minus the consistency loss.",
      },
      {
        label: "Replacement Value PPG",
        display: f(p.baseline, 2),
        note: "Mean Value PPG of the top available players at this position.",
      },
      {
        label: "VORP",
        display: f(p.vorp, 1),
        note: "Value above replacement over the remaining available games.",
      },
      {
        label: "Surplus index",
        display: f(p.index, 0),
        note: "Relative remaining-season surplus above available replacements; not a market price.",
      },
    ],
    status: `Model data: ${p.status}. Replacement pool: ${p.baselineStatus}.`,
  };
}
