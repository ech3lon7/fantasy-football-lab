import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { defaults } from "../src/domain/contracts";
// Filter serialization must remain accepted by the existing shared-project RPC.
import {
  encodeGemFilters,
  risingGemDraft,
  validateGemDraft,
} from "../src/domain/gem-screening";
const db = new PGlite();
let fitnessBefore: unknown;
async function fitnessSnapshot() {
  return {
    tables: (
      await db.query(
        "select relname, relacl::text, relrowsecurity from pg_class where relname like 'fitness_%' order by relname",
      )
    ).rows,
    policies: (
      await db.query(
        "select * from pg_policies where tablename like 'fitness_%' order by tablename,policyname",
      )
    ).rows,
    functions: (
      await db.query(
        "select pg_get_functiondef(oid) as definition from pg_proc where proname='apply_fitness_sync_change'",
      )
    ).rows,
    data: (
      await db.query(
        "select * from public.fitness_sync_records order by record_id",
      )
    ).rows,
    snapshots: (await db.query("select * from public.fitness_snapshots")).rows,
  };
}
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
const state = {
  preferredTeam: "1",
  settings: defaults,
  draft: { teamA: "1", teamB: "2", give: ["10"], get: [] },
  filters: {},
};
const dataset = {
  schemaVersion: 1,
  adapterVersion: "v5.2",
  modelVersion: "v5.2-port-1",
  hash: "a".repeat(64),
  importedAt: new Date().toISOString(),
  sourceUTC: null,
  tables: {
    ModelContext: [{}],
    ModelTeams: [],
    ModelPlayers: [{ PlayerID: 10, OnTeamID: 1 }],
    ModelHistory: [],
    ModelSchedule: [],
    ModelRosters: [],
  },
  settings: defaults,
  issues: [],
};
async function as(user: string, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${role}`);
}
beforeAll(async () => {
  await db.exec(
    "create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;",
  );
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  // Synthetic existing app objects, including its policies, grants and data.
  await db.exec(`
    create table public.fitness_snapshots(id integer primary key, payload jsonb);
    create table public.fitness_sync_records(user_id uuid, record_id text primary key, payload jsonb);
    alter table public.fitness_sync_records enable row level security;
    grant select,insert,update on public.fitness_sync_records to authenticated;
    create policy fitness_sync_records_select_own on public.fitness_sync_records
      for select to authenticated using(auth.uid()=user_id);
    create function public.apply_fitness_sync_change() returns text language sql as $$select 'synthetic sentinel'::text$$;
    insert into public.fitness_snapshots values(1,'{"synthetic":true}');
    insert into public.fitness_sync_records values('${a}','synthetic-record','{"synthetic":true}');
  `);
  fitnessBefore = await fitnessSnapshot();
  const sql = await fs.readFile(
    "supabase/migrations/001_workspace.sql",
    "utf8",
  );
  try {
    await db.exec(sql);
  } catch (e) {
    const error = e as {
      position?: string;
      internalPosition?: string;
      internalQuery?: string;
      where?: string;
    };
    console.error(
      "SQL diagnostic",
      error.position,
      error.internalPosition,
      error.where,
      sql.slice(
        Math.max(0, Number(error.position) - 120),
        Number(error.position) + 120,
      ),
    );
    throw e;
  }
}, 30000);
afterAll(async () => {
  await db.close();
});
it("isolates accounts, enforces RPC-only writes and revision conflicts", async () => {
  await as(a);
  await db.query("select public.initialize_fantasy_workspace($1)", [state]);
  await db.query("select public.replace_fantasy_dataset(0,$1,$2)", [
    crypto.randomUUID(),
    dataset,
  ]);
  await expect(
    db.query("update public.fantasy_workspaces set dataset_revision=999"),
  ).rejects.toThrow(/permission denied/i);
  await expect(
    db.query("select public.replace_fantasy_dataset(0,$1,$2)", [
      crypto.randomUUID(),
      dataset,
    ]),
  ).rejects.toThrow(/CONFLICT_DATASET/);
  await as(b);
  expect(
    (await db.query("select * from public.get_fantasy_workspace()")).rows,
  ).toHaveLength(0);
  await db.query("select public.initialize_fantasy_workspace($1)", [state]);
  expect(
    (await db.query("select * from public.get_fantasy_workspace()")).rows,
  ).toHaveLength(1);
  await as("", "anon");
  await expect(
    db.query("select * from public.get_fantasy_workspace()"),
  ).rejects.toThrow(/permission denied/i);
});
it("handles retries without appending snapshots and does not resurrect deletion", async () => {
  await as(a);
  const request = crypto.randomUUID();
  await db.query("select public.replace_fantasy_dataset(1,$1,$2)", [
    request,
    dataset,
  ]);
  await db.query("select public.replace_fantasy_dataset(1,$1,$2)", [
    request,
    dataset,
  ]);
  const rows = await db.query<{ dataset_revision: number }>(
    "select dataset_revision from public.get_fantasy_workspace()",
  );
  expect(Number(rows.rows[0].dataset_revision)).toBe(2);
  expect(rows.rows).toHaveLength(1);
  await expect(
    db.query("select public.replace_fantasy_dataset(2,$1,$2)", [
      request,
      { ...dataset, hash: "b".repeat(64) },
    ]),
  ).rejects.toThrow(/REQUEST_ID_REUSED/);
  await db.query("select public.delete_fantasy_workspace()");
  expect(
    (await db.query("select * from public.get_fantasy_workspace()")).rows,
  ).toHaveLength(0);
  await expect(
    db.query("select public.replace_fantasy_dataset(2,$1,$2)", [
      crypto.randomUUID(),
      dataset,
    ]),
  ).rejects.toThrow(/WORKSPACE_MISSING/);
});
it("enforces state revision and dataset revision separately", async () => {
  await as(b);
  await expect(
    db.query("select public.update_fantasy_state(1,0,$1,$2)", [
      crypto.randomUUID(),
      state,
    ]),
  ).rejects.toThrow(/CONFLICT_STATE/);
  const request = crypto.randomUUID();
  await db.query("select public.update_fantasy_state(0,0,$1,$2)", [
    request,
    state,
  ]);
  await db.query("select public.update_fantasy_state(0,0,$1,$2)", [
    request,
    state,
  ]);
  const rows = await db.query<{ state_revision: number }>(
    "select state_revision from public.get_fantasy_workspace()",
  );
  expect(Number(rows.rows[0].state_revision)).toBe(1);
});
it("rejects missing schemas and invalid model settings at the server boundary", async () => {
  await as(b);
  const missing: Partial<typeof dataset> = { ...dataset };
  delete missing.schemaVersion;
  await expect(
    db.query("select public.replace_fantasy_dataset(0,$1,$2)", [
      crypto.randomUUID(),
      missing,
    ]),
  ).rejects.toThrow(/INVALID_DATASET_SCHEMA/);
  await expect(
    db.query("select public.update_fantasy_state(1,0,$1,$2)", [
      crypto.randomUUID(),
      { ...state, settings: { ...defaults, PriorGames: 0 } },
    ]),
  ).rejects.toThrow(/INVALID_SETTING_RANGE/);
  await expect(
    db.query("select public.update_fantasy_state(1,0,$1,$2)", [
      crypto.randomUUID(),
      { ...state, settings: { ...defaults, GradeB: -0.9 } },
    ]),
  ).rejects.toThrow(/INVALID_GRADE_ORDER/);
});
it("preserves existing fitness data, policies, grants and functions across migration and fantasy writes", async () => {
  await db.exec("reset role");
  expect(await fitnessSnapshot()).toEqual(fitnessBefore);
  // Reapplying the fantasy migration must also leave the existing app intact.
  await db.exec(
    await fs.readFile("supabase/migrations/001_workspace.sql", "utf8"),
  );
  expect(await fitnessSnapshot()).toEqual(fitnessBefore);
  await db.exec(await fs.readFile("supabase/preflight.sql", "utf8"));
});

// Round-trip new searches without a migration, dataset write, or unrelated state change.
it("syncs applied gem filters through the existing state revision contract", async () => {
  await as(b);
  const current = (
    await db.query<{
      state: typeof state;
      state_revision: number;
      dataset_revision: number;
    }>(
      "select state,state_revision,dataset_revision from public.get_fantasy_workspace()",
    )
  ).rows[0];
  const query = validateGemDraft(risingGemDraft("1"), ["1", "2"]).query!;
  const filters = { unrelated: "retain-me", ...encodeGemFilters(query) };
  await db.query("select public.update_fantasy_state($1,$2,$3,$4)", [
    current.state_revision,
    current.dataset_revision,
    crypto.randomUUID(),
    { ...current.state, filters },
  ]);
  const next = (
    await db.query<{ state: typeof state; dataset_revision: number }>(
      "select state,dataset_revision from public.get_fantasy_workspace()",
    )
  ).rows[0];
  expect(next.state.filters).toEqual(filters);
  expect(next.state.draft).toEqual(current.state.draft);
  expect(next.state.settings).toEqual(current.state.settings);
  expect(next.dataset_revision).toBe(current.dataset_revision);
});
