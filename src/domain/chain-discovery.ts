import type { Position, Draft } from "./contracts";
import type { ChainQuery, TradeChain } from "./trade-chains";
import {
  applyLimitsToChainQuery,
  widenedLimits,
  type SearchLimits,
} from "./search-limits";
import type { PositionalGradeImpactRule } from "./chain-position-impact";
import { teamsAssessment } from "./lineups";
import { positionGradeScale } from "./trade-safeguards";
import type { Model } from "./valuation";

// Scenario and strictness are separate preferences; none of these provisional limits estimates acceptance accuracy.
export type ChainStrictness = "conservative" | "balanced" | "negotiable";
export type ChainRanking = "own" | "mutual" | "appeal";
export interface ChainDiscovery {
  sequences: "connected" | "sequential" | "both";
  ranking: ChainRanking;
  position?: Position | "depth";
  requiredTargets?: string[];
  pinnedFirst?: Draft;
  broaden?: {
    enabled: boolean;
    maximumRecipientLoss: number;
    maximumValueLossPct: number;
    indexExtra: number;
  };
}
export const chainPresets = [
  { id: "balanced", label: "Balanced opportunities" },
  { id: "mutual", label: "Mutual benefit" },
  { id: "star", label: "Acquire a star" },
  { id: "depth", label: "Turn a star into depth" },
  { id: "surface", label: "Surface-stat trading" },
  { id: "connected", label: "Connected chains" },
  { id: "coverage", label: "Acquire coverage, then upgrade" },
  { id: "speculative", label: "Speculative sequences" },
  { id: "need", label: "Fix my weakest position" },
  { id: "flip", label: "Buy low, then flip" },
] as const;

// Plain descriptions for the preset cards. None of them mentions a limit, because presets never change the shared limits.
export const chainPresetDescriptions: Record<
  (typeof chainPresets)[number]["id"],
  string
> = {
  balanced:
    "Two-trade routes that help you without asking much of the other teams.",
  mutual: "Routes where both teams in each trade end up better off.",
  star: "Package depth into one starter-level player.",
  depth: "Turn one star into several useful starters or reserves.",
  surface: "Routes ranked by how appealing each step looks on surface stats.",
  connected: "Second trades that build on what the first trade brings in.",
  coverage: "Add cover at a position first, then upgrade around it.",
  speculative:
    "Allow a first trade that costs points if the second recovers them.",
  need: "Aim at your lowest-graded position, without letting other positions slip.",
  flip: "Buy a BUY LOW player first, then sell a SELL HIGH player.",
};

// Saved presets stored the earlier label text; they load under the current name.
export const renamedPresetLabels: Record<string, string> = {
  "Surface-stat opportunities": "Surface-stat trading",
};
export const currentPresetLabel = (label: string) =>
  renamedPresetLabels[label] ?? label;
const strictnessLimits = {
  conservative: { gain: 0, value: 0.1, lossCap: 1, valueCap: 0.15, index: 5 },
  balanced: { gain: -1.5, value: 0.2, lossCap: 2.5, valueCap: 0.25, index: 10 },
  negotiable: {
    gain: -3.25,
    value: 0.25,
    lossCap: 4,
    valueCap: 0.35,
    index: 20,
  },
};

// Strictness also works after manual/custom edits, changing only its recipient, price and recovery limits.
export function applyChainStrictness(
  q: ChainQuery,
  strictness: ChainStrictness,
  mutual = false,
): ChainQuery {
  const limits = strictnessLimits[strictness];
  return {
    ...q,
    pricePolicy: strictness === "conservative" ? "required" : "warnings",
    recipient: {
      maximumValueLossPct: limits.value,
      minimumGain: mutual ? 0 : limits.gain,
    },
    discovery: {
      sequences: "both",
      ranking: "own",
      ...q.discovery,
      broaden: {
        enabled: q.discovery?.broaden?.enabled ?? true,
        maximumRecipientLoss: mutual ? 0 : limits.lossCap,
        maximumValueLossPct: limits.valueCap,
        indexExtra: limits.index,
      },
    },
  };
}

// Applying a preset is explicit. Teams, protected pool, required targets, position selection and optional fit/surface requirements survive.
export function applyChainPreset(
  q: ChainQuery,
  id: string,
  strictness: ChainStrictness = "balanced",
  // Needed only by "Fix my weakest position": the team's lowest-graded starting position and the rest.
  context?: { weakest: string | null; others: string[] },
): ChainQuery {
  // Old saved labels remain usable without being advertised as additional scenario presets.
  const legacy: Record<string, [number, number, "required" | "warnings"]> = {
    "very-lenient": [2, 0, "warnings"],
    lenient: [3, 0.1, "warnings"],
    strict: [5, 0.5, "required"],
    "very-strict": [8, 1, "required"],
  };
  if (legacy[id]) {
    const [minimumGain, minimumRecipient, pricePolicy] = legacy[id];
    return {
      ...q,
      minimumGain,
      pricePolicy,
      recipient: { maximumValueLossPct: 0.1, minimumGain: minimumRecipient },
    };
  }
  if (!chainPresets.some((p) => p.id === id)) return q;
  const limits = strictnessLimits[strictness];
  const mutual = id === "mutual";
  const step = (value: ChainQuery["first"]) => ({
    ...value,
    offer: { minimum: 1, maximum: 3 },
    receive: { minimum: 1, maximum: 3 },
  });
  // Goals and labels a preset adds are removed when another preset is chosen; goals you set yourself stay.
  const clean = (s: ChainQuery["first"]) => {
    const {
      receiveRegression: _r,
      sendRegression: _s,
      gradeImpacts,
      ...rest
    } = s;
    void _r;
    void _s;
    const kept = (gradeImpacts ?? []).filter(
      (g) => !g.id.startsWith("preset-need-"),
    );
    return kept.length ? { ...rest, gradeImpacts: kept } : rest;
  };
  const first = step(clean(q.first)),
    second = step(clean(q.second));
  if (id === "need" && context?.weakest) {
    const rule = (
      position: string,
      type: "upgrade" | "drop_limit",
    ): PositionalGradeImpactRule => ({
      id: `preset-need-${type}-${position}`,
      side: "own",
      position,
      steps: 2,
      type,
    });
    const keep = context.others
      .filter((p) => p !== context.weakest)
      .map((p) => rule(p, "drop_limit"));
    first.gradeImpacts = [
      ...(first.gradeImpacts ?? []),
      rule(context.weakest, "upgrade"),
      ...keep,
    ];
    second.gradeImpacts = [...(second.gradeImpacts ?? []), ...keep];
  }
  // Trade one must receive a BUY LOW player and trade two must send a SELL HIGH player.
  if (id === "flip") {
    first.receiveRegression = "BUY LOW";
    second.sendRegression = "SELL HIGH";
  }
  // The coverage preset requires a first-step WR while allowing either meaningful connected route by default.
  if (id === "coverage") first.receivePosition ??= "WR";
  if (id === "star") {
    first.offer.minimum = 2;
    first.receive.maximum = 2;
  }
  if (id === "depth") {
    first.offer.maximum = 2;
    first.receive.minimum = 2;
  }
  // An explicitly locked first exchange keeps its exact package shape when a scenario is changed.
  if (q.discovery?.pinnedFirst) {
    first.offer = {
      minimum: q.discovery.pinnedFirst.give.length,
      maximum: q.discovery.pinnedFirst.give.length,
    };
    first.receive = {
      minimum: q.discovery.pinnedFirst.get.length,
      maximum: q.discovery.pinnedFirst.get.length,
    };
  }
  return {
    ...q,
    first,
    second,
    mode: id === "speculative" ? "both" : "safe",
    maximumLoss: id === "speculative" ? 3 : 0,
    minimumGain: id === "coverage" ? 1 : 2,
    pricePolicy: strictness === "conservative" ? "required" : "warnings",
    recipient: {
      maximumValueLossPct: limits.value,
      minimumGain: mutual || id === "coverage" ? 0 : limits.gain,
    },
    dependency:
      id === "coverage"
        ? {
            minimumAcquiredShare: 0.25,
            minimumInteractionGain: 2,
            ...q.dependency,
            route: "either",
          }
        : q.dependency,
    discovery: {
      ...q.discovery,
      sequences: id === "connected" || id === "coverage" ? "connected" : "both",
      ranking: mutual ? "mutual" : id === "surface" ? "appeal" : "own",
      broaden: {
        enabled: true,
        maximumRecipientLoss: mutual || id === "coverage" ? 0 : limits.lossCap,
        maximumValueLossPct: limits.valueCap,
        indexExtra: limits.index,
      },
    },
  };
}

// The team's lowest-graded starting position and the other graded ones, for "Fix my weakest position".
export function presetContext(
  m: Model,
  team: string,
): { weakest: string | null; others: string[] } {
  const graded = (teamsAssessment(m).get(team) ?? [])
    .filter((g) => ["QB", "RB", "WR", "TE"].includes(g.position))
    .map((g) => ({
      position: g.position,
      rank: positionGradeScale.findIndex((s) => s === g.grade),
    }))
    .filter((g) => g.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.position.localeCompare(b.position));
  return {
    weakest: graded[0]?.position ?? null,
    others: graded.slice(1).map((g) => g.position),
  };
}

// A preset describes the kind of chain only: the shared limits always win over anything the preset sets.
export function applyChainPresetKeepingLimits(
  q: ChainQuery,
  id: string,
  limits: SearchLimits,
  context?: { weakest: string | null; others: string[] },
): ChainQuery {
  return applyLimitsToChainQuery(
    applyChainPreset(q, id, "balanced", context),
    limits,
  );
}

// Automatic recovery changes only the three authorized soft limits; every other query field is copied verbatim.
export function chainSearchRounds(q: ChainQuery) {
  // The single method widens from the user's own limits, each round saying which limit moved and by how much.
  if (q.limits) {
    const { limits, ...rest } = q;
    return widenedLimits(limits).map((round) => ({
      query: applyLimitsToChainQuery({ ...rest }, round.limits),
      changes: round.changes,
    }));
  }
  const b = q.discovery?.broaden;
  const base = {
    ...q,
    discovery: q.discovery ? { ...q.discovery, broaden: undefined } : undefined,
  };
  const rounds = [{ query: base, changes: [] as string[] }];
  if (!b?.enabled) return rounds;
  for (const fraction of [0.5, 1]) {
    const recipient = q.recipient ?? {
      maximumValueLossPct: 0.1,
      minimumGain: 1,
    };
    const minimumGain = Math.min(
      recipient.minimumGain,
      recipient.minimumGain +
        (-b.maximumRecipientLoss - recipient.minimumGain) * fraction,
    );
    const maximumValueLossPct = Math.max(
      recipient.maximumValueLossPct,
      recipient.maximumValueLossPct +
        (b.maximumValueLossPct - recipient.maximumValueLossPct) * fraction,
    );
    const changes: string[] = [];
    if (minimumGain !== recipient.minimumGain)
      changes.push(
        `Recipient minimum ${recipient.minimumGain.toFixed(2)} → ${minimumGain.toFixed(2)} EPPG`,
      );
    if (maximumValueLossPct !== recipient.maximumValueLossPct)
      changes.push(
        `Recipient value concession ${(recipient.maximumValueLossPct * 100).toFixed(1)}% → ${(maximumValueLossPct * 100).toFixed(1)}%`,
      );
    const widen = (s: ChainQuery["first"], label: string) => {
      if (!s.indexWindow || !b.indexExtra) return s;
      const extra = b.indexExtra * fraction;
      changes.push(
        `${label} index window widened by ${extra.toFixed(2)} on each side`,
      );
      return {
        ...s,
        indexWindow: {
          below: s.indexWindow.below + extra,
          above: s.indexWindow.above + extra,
        },
      };
    };
    const first = widen(base.first, "First trade"),
      second = widen(base.second, "Second trade");
    if (changes.length)
      rounds.push({
        query: {
          ...base,
          recipient: { minimumGain, maximumValueLossPct },
          first,
          second,
        },
        changes,
      });
  }
  return rounds;
}

// Sort completed possibilities independently of eligibility; apparent appeal is a source-stat ranking, never a probability of acceptance.
export function chainRankingScore(c: TradeChain, ranking: ChainRanking) {
  if (ranking === "own") return c.gain;
  if (ranking === "mutual")
    return Math.min(c.gain, c.first.row.other!, c.second.row.other!);
  const sourceGain = (leg: TradeChain["first"]) => {
    const values = [
      leg.surface?.average.gain,
      leg.surface?.projection.gain,
    ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : leg.row.other!;
  };
  return Math.min(sourceGain(c.first), sourceGain(c.second));
}
