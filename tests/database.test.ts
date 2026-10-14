import { beforeAll, afterAll, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { defaults } from "../src/domain/contracts";
const db = new PGlite();
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
  modelVersion: "test",
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
