import { z } from "zod";
import { draftSchema, type Draft } from "./contracts";
import {
  managerProfileSchema,
  type ManagerAssessment,
} from "./manager-expectations";
import type { Model } from "./valuation";

// Strict, bounded private records live outside the small synchronized application settings payload.
const text = z.string().max(4000),
  id = z.string().min(1).max(150),
  utc = z.string().datetime();
export const journalOutcomeSchema = z.enum([
  "accepted",
  "rejected",
  "countered",
  "pending",
  "unknown",
]);
export const offerSchema = z
  .object({
    negotiation: id,
    parent: id.optional(),
    season: z.string().max(20),
    week: z.number().int().min(1).max(25).nullable(),
    recordedUTC: utc,
    date: z.string().max(50).default(""),
    draft: draftSchema,
    names: z.record(z.string(), z.string().max(200)).default({}),
    teamNames: z.record(z.string(), z.string().max(200)).default({}),
    outcome: journalOutcomeSchema,
    responseActor: z.string().max(150),
    provenance: z.enum([
      "documented",
      "prospective",
      "retrospective",
      "simulation",
    ]),
    recipientIsUser: z.boolean(),
    notes: text.default(""),
    responses: z
      .array(
        z
          .object({
            outcome: journalOutcomeSchema,
            actor: id,
            recordedUTC: utc,
          })
          .strict(),
      )
      .max(200)
      .default([]),
  })
  .strict();
export type JournalOffer = z.infer<typeof offerSchema>;
const comparison = z
  .object({
    before: z.number().finite().nullable(),
    after: z.number().finite().nullable(),
    gain: z.number().finite().nullable(),
    slots: z.array(z.string()),
    beforeIds: z.array(z.string().nullable()),
    afterIds: z.array(z.string().nullable()),
    missing: z.array(z.string()),
    issues: z.array(z.string()),
  })
  .strict();
const compensation = z
  .object({
    incoming: id,
    incumbent: id,
    gain: z.number().finite(),
    required: z.number().finite(),
  })
  .strict();
// Freeze all numeric evidence used by the estimate rather than duplicating an entire imported workbook for each offer.
export const managerAssessmentSchema = z
  .object({
    version: z.literal("surface-manager-1"),
    status: z.enum([
      "eligible",
      "conditional",
      "safeguard-failed",
      "unavailable",
    ]),
    preset: z.number().int().min(0).max(4),
    sourceUTC: z.string().nullable(),
    datasetHash: z.string(),
    season: z.string(),
    week: z.number(),
    average: comparison.optional(),
    projection: comparison.optional(),
    checks: z
      .array(
        z
          .object({
            outgoing: id,
            incoming: id,
            samePosition: z.boolean(),
            required: z.number().finite(),
            actual: z.number().finite().nullable(),
            qualifies: z.boolean(),
            compensation: z.number().finite(),
          })
          .strict(),
      )
      .max(25)
      .optional(),
    population: z
      .object({
        imported: z.number().int(),
        completeActual: z.number().int(),
        positionalSample: z.number().int(),
      })
      .strict()
      .optional(),
    matches: z
      .array(
        z
          .object({
            outgoing: id,
            incoming: id,
            tier: text,
            samePosition: z.boolean(),
            required: z.number().finite(),
            actual: z.number().finite(),
            stronger: z.boolean(),
            comfortable: z.boolean(),
            compensation: compensation.optional(),
          })
          .strict(),
      )
      .max(5),
    band: z.number().int().min(-2).max(2).optional(),
    range: z.tuple([z.number(), z.number()]).optional(),
    baseBand: z.number().int().min(-2).max(2).optional(),
    comfort: z.number().int().min(0).max(1).optional(),
    caution: z.number().int().min(0).max(1).optional(),
    preferred: z.number().finite(),
    margin: z.number().finite().optional(),
    reasons: z.array(text),
    warnings: z.array(text),
    evidence: z
      .array(
        z
          .object({
            id,
            actual: z.number().finite().nullable(),
            games: z.number(),
            rank: z.number().nullable(),
            totalRank: z.number().nullable(),
            weekly: z.number().finite().nullable().optional(),
            pos: z.string().optional(),
            injury: z.string().optional(),
            bye: z.number().optional(),
            slot: z.number().optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export const journalEntrySchema = z.discriminatedUnion("kind", [
  z.object({ id, kind: z.literal("offer"), payload: offerSchema }).strict(),
  z
    .object({
      id,
      kind: z.literal("profile"),
      payload: managerProfileSchema
        .extend({
          team: id,
          notes: text.default(""),
          reviewed: z.array(id).max(1000).default([]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("context"),
      payload: z
        .object({
          source: z.string().max(100),
          rows: z
            .array(
              z.record(
                z.string().max(100),
                z.union([
                  z.string().max(4000),
                  z.number().finite(),
                  z.boolean(),
                  z.null(),
                ]),
              ),
            )
            .max(200),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      id,
      kind: z.literal("forecast"),
      payload: z
        .object({
          offer: id,
          preservedFrom: id.optional(),
          recordedUTC: utc,
          assessment: managerAssessmentSchema,
          draft: draftSchema,
          origin: z.enum(["prospective", "retrospective", "simulation"]),
          context: text,
          privateImpact: z
            .object({
              basis: z.enum(["best-available", "marked-starters"]),
              ownBefore: z.number().finite().nullable(),
              ownAfter: z.number().finite().nullable(),
              ownGain: z.number().finite().nullable(),
              otherBefore: z.number().finite().nullable(),
              otherAfter: z.number().finite().nullable(),
              otherGain: z.number().finite().nullable(),
            })
            .strict()
            .optional(),
          settings: z.string().max(200000),
          names: z.record(z.string(), z.string().max(200)),
          // Exact scenario/lineup settings and relevant legal rosters make original figures inspectable after refresh.
          rosters: z
            .object({
              before: z.array(id).max(100),
              after: z.array(id).max(100),
              drops: z.array(id).max(100),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
]);
export type JournalEntry = z.infer<typeof journalEntrySchema>;
export const journalImportSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(journalEntrySchema).max(10000),
  })
  .strict();

// Generate a draft journal entry only on explicit user action; search results and simulated deals never become historical responses.
export function newJournalOffer(
  m: Model,
  draft: Draft,
  ownTeam: string,
  recordedUTC: string,
): JournalOffer {
  return offerSchema.parse({
    negotiation: crypto.randomUUID(),
    season: String(m.dataset.tables.ModelContext[0].Season ?? ""),
    week: m.current,
    recordedUTC,
    draft,
    names: Object.fromEntries(
      [...new Set([...draft.give, ...draft.get])].map((id) => [
        id,
        m.byId.get(id)?.name ?? id,
      ]),
    ),
    teamNames: Object.fromEntries(
      m.dataset.tables.ModelTeams.map((t) => [
        String(t.TeamID),
        String(t.TeamName),
      ]),
    ),
    outcome: "pending",
    responseActor: draft.teamB,
    provenance: "prospective",
    recipientIsUser: draft.teamB === ownTeam,
    notes: "",
  });
}

// Calibration counts actual opposing responses only, and keeps different versions of one negotiation identifiable.
export function journalCalibration(entries: JournalEntry[]) {
  const offers = new Map(
    entries.filter((e) => e.kind === "offer").map((e) => [e.id, e]),
  );
  const bins = [-2, -1, 0, 1, 2].map((band) => ({
    band,
    tried: 0,
    accepted: 0,
    negotiations: new Set<string>(),
  }));
  const seen = new Set<string>();
  for (const e of [...entries].sort(
    (a, b) =>
      (a.kind === "forecast" ? a.payload.recordedUTC : "").localeCompare(
        b.kind === "forecast" ? b.payload.recordedUTC : "",
      ) || a.id.localeCompare(b.id),
  ))
    if (
      e.kind === "forecast" &&
      e.payload.origin === "prospective" &&
      !e.payload.preservedFrom &&
      e.payload.assessment.status === "eligible" &&
      !!e.payload.assessment.range &&
      e.payload.assessment.band !== undefined
    ) {
      const offer = offers.get(e.payload.offer);
      if (
        !offer ||
        offer.kind !== "offer" ||
        offer.payload.recipientIsUser ||
        offer.payload.provenance !== "prospective" ||
        !["accepted", "rejected", "countered"].includes(
          offer.payload.outcome,
        ) ||
        seen.has(offer.id)
      )
        continue;
      const firstResponse = offer.payload.responses
        .filter((response) =>
          ["accepted", "rejected", "countered"].includes(response.outcome),
        )
        .map((response) => response.recordedUTC)
        .sort()[0];
      if (!firstResponse || e.payload.recordedUTC > firstResponse) continue;
      seen.add(offer.id);
      const bin = bins[e.payload.assessment.band + 2];
      bin.tried++;
      bin.accepted += Number(offer.payload.outcome === "accepted");
      bin.negotiations.add(offer.payload.negotiation);
    }
  return bins.map((b) => ({ ...b, negotiations: b.negotiations.size }));
}

// Suggestions expose evidence for human review and never change a manager's preset automatically.
export function profileSuggestion(entries: JournalEntry[], team: string) {
  const responses = entries.filter(
    (e): e is Extract<JournalEntry, { kind: "offer" }> =>
      e.kind === "offer" &&
      e.payload.draft.teamB === team &&
      !e.payload.recipientIsUser &&
      e.payload.provenance !== "simulation" &&
      ["accepted", "rejected", "countered"].includes(e.payload.outcome),
  );
  const groups = new Map<string, typeof responses>();
  for (const e of responses)
    groups.set(e.payload.negotiation, [
      ...(groups.get(e.payload.negotiation) ?? []),
      e,
    ]);
  if (groups.size < 3) return null;
  const accepted = [...groups.values()].filter((g) =>
    g.some((e) => e.payload.outcome === "accepted"),
  ).length;
  return {
    negotiations: groups.size,
    accepted,
    ids: responses.map((e) => e.id),
    message: `Review this profile using ${groups.size} distinct negotiations (${accepted} with an accepted version). Outcomes alone do not establish the reason or automatically justify a preset change.`,
  };
}

// Stored snapshots use the same runtime schema as imported and cloud records, preserving nulls and numeric units.
export function freezeAssessment(value: ManagerAssessment) {
  return managerAssessmentSchema.parse(value);
}

// PostgreSQL JSONB key ordering and import timestamps do not create false conflicts; changed facts/outcomes still do.
export function sameJournalEntry(a: JournalEntry, b: JournalEntry) {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  const normalize = (entry: JournalEntry) =>
    entry.kind === "offer" && entry.payload.provenance === "documented"
      ? { ...entry, payload: { ...entry.payload, recordedUTC: "" } }
      : entry;
  return (
    JSON.stringify(canonical(normalize(a))) ===
    JSON.stringify(canonical(normalize(b)))
  );
}

// A recipient's counter is a response; the original proposer improving their own offer does not invent a recipient action.
export function linkedJournalOffer(
  parent: Extract<JournalEntry, { kind: "offer" }>,
  child: JournalOffer,
  id: string = crypto.randomUUID(),
): JournalEntry[] {
  const pair = [parent.payload.draft.teamA, parent.payload.draft.teamB]
    .sort()
    .join("/");
  if ([child.draft.teamA, child.draft.teamB].sort().join("/") !== pair)
    throw Error(
      "Linked versions must use the same two managers. Start a separate negotiation for another team.",
    );
  const next: JournalEntry[] = [
    {
      id,
      kind: "offer",
      payload: {
        ...child,
        parent: parent.id,
        negotiation: parent.payload.negotiation,
      },
    },
  ];
  if (
    child.draft.teamA === parent.payload.draft.teamB &&
    parent.payload.outcome !== "accepted"
  ) {
    const previous =
      parent.payload.responses.length ||
      ["pending", "unknown"].includes(parent.payload.outcome)
        ? parent.payload.responses
        : [
            {
              outcome: parent.payload.outcome,
              actor: parent.payload.responseActor,
              recordedUTC: parent.payload.recordedUTC,
            },
          ];
    next.push({
      ...parent,
      payload: {
        ...parent.payload,
        outcome: "countered",
        responseActor: child.draft.teamA,
        responses: [
          ...previous,
          {
            outcome: "countered",
            actor: child.draft.teamA,
            recordedUTC: child.recordedUTC,
          },
        ],
      },
    });
  }
  return next;
}
