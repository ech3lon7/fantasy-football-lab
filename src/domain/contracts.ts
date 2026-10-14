import { z } from "zod";
export const MODEL_VERSION = "v5.2-port-1";
export const positions = ["QB", "RB", "WR", "TE", "K", "D/ST"] as const;
export type Position = (typeof positions)[number];
export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
const cell = z.union([
  z.string().max(40000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const tableNames = [
  "ModelContext",
  "ModelTeams",
  "ModelPlayers",
  "ModelHistory",
  "ModelSchedule",
  "ModelRosters",
] as const;
export const defaults = {
  PriorGames: 4,
  RecentWeight: 0.25,
  ConsistencyCoefficient: 0.1,
  ConsistencyCap: 0.1,
  MinConsistencyGames: 4,
  MinOpportunity: 10,
  CarriesPerTD: 32.5,
  TargetsPerTD: 11,
  Premium: 0.3,
  FairBandPct: 0.05,
  ExcellentPct: 0.2,
  StealPct: 0.5,
  BadLossPct: 0.2,
  HorribleLossPct: 0.5,
  GemMinGames: 4,
  GemMinGap: 2,
  GemMinGapPct: 0.2,
  GemMinPriorGames: 2,
  GemTrendFloor: 1,
  GemTrendPctFloor: 0.1,
  GemWRTargets: 6,
  GemWRShare: 0.18,
  GemTETargets: 5,
  GemTEShare: 0.1,
  GemRBOpportunities: 12,
  GemRBRushShare: 0.3,
  GemRBTargetShare: 0.1,
  ReserveCutoff: 0.1,
  GradeDMinus: -0.35,
  GradeD: -0.3,
  GradeDPlus: -0.25,
  GradeCMinus: -0.2,
  GradeC: -0.15,
  GradeCPlus: -0.1,
  GradeBMinus: -0.05,
  GradeB: 0,
  GradeBPlus: 0.05,
  GradeAMinus: 0.1,
  GradeA: 0.15,
  GradeAPlus: 0.25,
};
export type Settings = typeof defaults;
export const settingsSchema = z
  .object(
    Object.fromEntries(
      Object.keys(defaults).map((k) => [k, z.number().finite()]),
    ) as Record<keyof Settings, z.ZodNumber>,
  )
  .strict()
  .superRefine((s, ctx) => {
    for (const [key, value] of Object.entries(s)) {
      const pct = [
        "RecentWeight",
        "ConsistencyCoefficient",
        "ConsistencyCap",
        "FairBandPct",
        "ExcellentPct",
        "StealPct",
        "BadLossPct",
        "HorribleLossPct",
        "GemMinGapPct",
        "GemTrendPctFloor",
        "GemWRShare",
        "GemTEShare",
        "GemRBRushShare",
        "GemRBTargetShare",
      ].includes(key);
      if (
        value < (key.startsWith("Grade") ? -1 : 0) ||
        ((pct || key.startsWith("Grade") || key === "ReserveCutoff") &&
          value > 1) ||
        value > 100
      )
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Value outside supported range",
        });
    }
    for (const key of ["PriorGames", "CarriesPerTD", "TargetsPerTD"] as const)
      if (s[key] <= 0)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Must be positive",
        });
    for (const key of [
      "MinConsistencyGames",
      "GemMinGames",
      "GemMinPriorGames",
    ] as const)
      if (!Number.isInteger(s[key]) || s[key] < 1 || s[key] > 17)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Use a whole number from 1 to 17",
        });
    if (s.Premium < 0.25 || s.Premium > 0.35)
      ctx.addIssue({
        code: "custom",
        path: ["Premium"],
        message: "Use 0.25–0.35",
      });
    if (!(
      s.FairBandPct > 0 &&
      s.FairBandPct < s.ExcellentPct &&
      s.ExcellentPct < s.StealPct &&
      s.FairBandPct < s.BadLossPct &&
      s.BadLossPct < s.HorribleLossPct
    ))
      ctx.addIssue({
        code: "custom",
        message: "Grade thresholds must be positive and ordered",
      });
    const bands = [
      s.GradeDMinus,
      s.GradeD,
      s.GradeDPlus,
      s.GradeCMinus,
      s.GradeC,
      s.GradeCPlus,
      s.GradeBMinus,
      s.GradeB,
      s.GradeBPlus,
      s.GradeAMinus,
      s.GradeA,
      s.GradeAPlus,
    ];
    if (bands.some((x, i) => i > 0 && x <= bands[i - 1]))
      ctx.addIssue({
        code: "custom",
        message: "Position grade thresholds must be strictly increasing",
      });
  });
export const datasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    adapterVersion: z.literal("v5.2"),
    modelVersion: z.literal(MODEL_VERSION),
    hash: z.string().max(100),
    importedAt: z.string().datetime(),
    sourceUTC: z.string().nullable(),
    tables: z
      .object(
        Object.fromEntries(
          tableNames.map((k) => [
            k,
            z
              .array(z.record(z.string(), cell))
              .max(k === "ModelHistory" ? 40000 : 10000),
          ]),
        ) as Record<
          (typeof tableNames)[number],
          z.ZodArray<z.ZodRecord<z.ZodString, typeof cell>>
        >,
      )
      .strict(),
    settings: settingsSchema,
    issues: z.array(z.string().max(500)).max(1000),
  })
  .strict();
export type Dataset = z.infer<typeof datasetSchema>;
export const draftSchema = z
  .object({
    teamA: z.string(),
    teamB: z.string(),
    give: z.array(z.string()).max(5),
    get: z.array(z.string()).max(5),
  })
  .strict();
export type Draft = z.infer<typeof draftSchema>;
export const stateSchema = z
  .object({
    preferredTeam: z.string(),
    settings: settingsSchema,
    draft: draftSchema,
    filters: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type AppState = z.infer<typeof stateSchema>;
export interface Workspace {
  dataset: Dataset | null;
  state: AppState;
  datasetRevision: number;
  stateRevision: number;
  pendingDataset: boolean;
  pendingState: boolean;
  requestId: string;
  stateRequestId: string;
  owner: string;
}
export const n = (x: unknown): number | null =>
  typeof x === "number" && Number.isFinite(x) ? x : null;
export const num = (x: unknown, fallback = 0): number =>
  n(x) ?? (typeof x === "boolean" ? Number(x) : fallback);
export const str = (x: unknown) => (x == null ? "" : String(x));
export const cmpId = (a: string, b: string) =>
  Number(a) - Number(b) || a.localeCompare(b);
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : null);
export const sd = (xs: number[], sample = true) => {
  const m = mean(xs);
  return m === null || xs.length < (sample ? 2 : 1)
    ? null
    : Math.sqrt(
        sum(xs.map((x) => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0)),
      );
};
export const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const a = [...xs].sort((a, b) => a - b),
    i = (a.length - 1) * q,
    l = Math.floor(i);
  return a[l] + (a[Math.ceil(i)] - a[l]) * (i - l);
};
export function initialState(d: Dataset): AppState {
  const teams = d.tables.ModelTeams;
  const a =
    teams.find((t) => str(t.TeamName).toLowerCase() === "los chilones") ??
    teams[0];
  return {
    preferredTeam: str(a?.TeamID),
    settings: { ...d.settings },
    draft: {
      teamA: str(a?.TeamID),
      teamB: str(teams.find((t) => t.TeamID !== a?.TeamID)?.TeamID),
      give: [],
      get: [],
    },
    filters: {},
  };
}
