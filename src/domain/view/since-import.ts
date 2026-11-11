import { z } from "zod";
import { playerSignals, type Model } from "../valuation";

// A small per-player summary of one import: names, active labels and Expected PPG. It is not the workbook.
export const importSummarySchema = z
  .object({
    version: z.literal(1),
    sourceUTC: z.string().nullable(),
    summarizedAt: z.string(),
    players: z.record(
      z.string(),
      z
        .object({
          name: z.string(),
          labels: z.array(z.string()),
          eppg: z.number().finite().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export type ImportSummary = z.infer<typeof importSummarySchema>;

// The labels worth comparing: active analytical labels, not neutral or data-coverage statuses.
const activeLabels = (labels: string[]) =>
  labels.filter(
    (x) => x && !/^(none|no |insufficient|not applicable)/i.test(x),
  );

// Summarize the current import so the next import can be compared with it.
export function summarizeImport(m: Model): ImportSummary {
  return {
    version: 1,
    sourceUTC: m.dataset.sourceUTC ?? null,
    summarizedAt: new Date().toISOString(),
    players: Object.fromEntries(
      m.players.map((p) => [
        p.id,
        {
          name: p.name,
          labels: activeLabels(playerSignals(p)),
          eppg:
            p.blendedExpected !== null && Number.isFinite(p.blendedExpected)
              ? p.blendedExpected
              : null,
        },
      ]),
    ),
  };
}

export type DigestKind = "new-label" | "lost-label" | "eppg-mover";
export interface DigestItem {
  kind: DigestKind;
  playerId: string;
  name: string;
  // For a label row, the label gained or lost.
  label: string | null;
  // For a mover row, the Expected PPG before and after, and the signed change.
  from: number | null;
  to: number | null;
  delta: number | null;
}

export interface Digest {
  // The source time of the import being compared against, for the footnote.
  comparedTo: string | null;
  items: DigestItem[];
}

// The smallest Expected PPG change worth listing as a mover.
const moverThreshold = 0.05;

// What changed since the previous import: labels gained and lost and the largest Expected PPG movers.
// Returns null when there is no previous import or nothing changed, so the section is hidden entirely.
export function importDigest(
  previous: ImportSummary | null,
  current: ImportSummary,
  limits = { labels: 8, movers: 4 },
): Digest | null {
  if (!previous) return null;
  const labelItems: DigestItem[] = [];
  const movers: DigestItem[] = [];
  for (const [id, now] of Object.entries(current.players)) {
    const before = previous.players[id];
    // A player who was not in the earlier import has nothing to compare against.
    if (!before) continue;
    for (const label of now.labels)
      if (!before.labels.includes(label))
        labelItems.push({
          kind: "new-label",
          playerId: id,
          name: now.name,
          label,
          from: null,
          to: null,
          delta: null,
        });
    for (const label of before.labels)
      if (!now.labels.includes(label))
        labelItems.push({
          kind: "lost-label",
          playerId: id,
          name: now.name,
          label,
          from: null,
          to: null,
          delta: null,
        });
    // A missing Expected PPG on either side is not a change; it is never treated as zero.
    if (before.eppg !== null && now.eppg !== null) {
      const delta = now.eppg - before.eppg;
      if (Math.abs(delta) >= moverThreshold)
        movers.push({
          kind: "eppg-mover",
          playerId: id,
          name: now.name,
          label: null,
          from: before.eppg,
          to: now.eppg,
          delta,
        });
    }
  }
  const order = (a: DigestItem, b: DigestItem) =>
    a.name.localeCompare(b.name) ||
    (a.label ?? "").localeCompare(b.label ?? "");
  labelItems.sort(
    (a, b) =>
      Number(b.kind === "new-label") - Number(a.kind === "new-label") ||
      order(a, b),
  );
  movers.sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!) || order(a, b));
  const items = [
    ...labelItems.slice(0, limits.labels),
    ...movers.slice(0, limits.movers),
  ];
  return items.length ? { comparedTo: previous.sourceUTC, items } : null;
}
