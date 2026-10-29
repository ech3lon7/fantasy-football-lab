import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { defaults } from "../src/domain/contracts";

// A disposable PostgreSQL instance exercises the migration with isolated synthetic accounts and a pre-existing unrelated table.
const db = new PGlite(),
  a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
async function as(user: string, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec(`set role ${role}`);
  currentUser = user;
}
beforeAll(async () => {
  await db.exec(
    "create schema auth;create role anon;create role authenticated;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table public.fitness_untouched(id integer primary key, value text);insert into public.fitness_untouched values(1,'unchanged');",
  );
  await db.query("insert into auth.users values($1),($2)", [a, b]);
  await db.exec(
    await fs.readFile("supabase/migrations/001_workspace.sql", "utf8"),
  );
  await db.exec(
    await fs.readFile("supabase/migrations/002_negotiations.sql", "utf8"),
  );
  for (const user of [a, b]) {
    await as(user);
    await db.query("select public.initialize_fantasy_workspace($1)", [
      {
        preferredTeam: "1",
        settings: defaults,
        draft: { teamA: "1", teamB: "2", give: [], get: [] },
        filters: {},
      },
    ]);
  }
}, 30000);
afterAll(async () => {
  await db.close();
});
let currentUser = a;
const put = (
  id: string,
  kind: string,
  payload: object,
  revision: number,
  request = crypto.randomUUID(),
) =>
  db.query<{ revision: number }>(
    "select * from public.put_fantasy_negotiation($1,$2,$3,$4,$5,$6)",
    [currentUser, id, kind, payload, revision, request],
  );

// Revision checks and request IDs permit safe retry while rejecting a stale second-device edit.
it("isolates records by account and checks revisions/idempotency", async () => {
  await as(a);
  const request = crypto.randomUUID();
  expect(
    (await put("offer-one", "offer", { outcome: "pending" }, 0, request))
      .rows[0].revision,
  ).toBe(1);
  expect(
    (await put("offer-one", "offer", { outcome: "pending" }, 0, request))
      .rows[0].revision,
  ).toBe(1);
  await expect(
    put("offer-one", "offer", { outcome: "rejected" }, 0),
  ).rejects.toThrow("CONFLICT_NEGOTIATION");
  await expect(
    put("offer-one", "offer", { outcome: "rejected" }, 1, request),
  ).rejects.toThrow("REQUEST_ID_REUSED");
  await as(b);
  expect(
    (
      await db.query("select * from public.get_fantasy_negotiations($1)", [
        currentUser || a,
      ])
    ).rows,
  ).toHaveLength(0);
  await put("offer-one", "offer", { outcome: "accepted" }, 0);
  expect(
    (
      await db.query("select * from public.get_fantasy_negotiations($1)", [
        currentUser || a,
      ])
    ).rows,
  ).toHaveLength(1);
});

// Immutable forecasts cannot be rewritten, even by their owner or through direct table writes.
it("prevents forecast mutation and anonymous/direct writes", async () => {
  await as(a);
  await put("forecast-one", "forecast", { range: [15, 45] }, 0);
  await expect(
    put("forecast-one", "forecast", { range: [45, 80] }, 1),
  ).rejects.toThrow("IMMUTABLE_FORECAST");
  await expect(
    db.query(
      "update public.fantasy_negotiation_records set payload='{}' where record_id='forecast-one'",
    ),
  ).rejects.toThrow(/permission denied/);
  await as("", "anon");
  await expect(
    db.query("select * from public.get_fantasy_negotiations($1)", [
      currentUser || a,
    ]),
  ).rejects.toThrow(/permission denied/);
  await as(a);
  await expect(
    put("big", "offer", { notes: "x".repeat(524288) }, 0),
  ).rejects.toThrow("INVALID_NEGOTIATION");
});

// Deleting Fantasy's workspace removes only its private journal; unrelated app data remains untouched.
it("cascades account workspace cleanup without changing unrelated tables", async () => {
  await as(a);
  await db.query("select public.delete_fantasy_workspace()");
  expect(
    (
      await db.query("select * from public.get_fantasy_negotiations($1)", [
        currentUser || a,
      ])
    ).rows,
  ).toHaveLength(0);
  await expect(put("late-write", "offer", {}, 0)).rejects.toThrow(
    "WORKSPACE_MISSING",
  );
  await db.exec("reset role");
  expect(
    (await db.query("select * from public.fitness_untouched")).rows,
  ).toEqual([{ id: 1, value: "unchanged" }]);
  await as(b);
  expect(
    (
      await db.query("select * from public.get_fantasy_negotiations($1)", [
        currentUser || a,
      ])
    ).rows,
  ).toHaveLength(1);
});
