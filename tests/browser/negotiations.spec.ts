import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { build } from "vite";
import {
  initialState,
  type Workspace,
  type Dataset,
} from "../../src/domain/contracts";
import { journalFromTables } from "../../src/import/trade-journal";

// Use a fresh browser account and synthetic workbook data; no private league records or real browser storage enter CI.
async function seed(page: Page) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {surfaceFixture} from './tests/surface-fixture.ts';process.stdout.write(JSON.stringify(await surfaceFixture()));",
      ],
      { encoding: "utf8" },
    ),
  );
  const w: Workspace = {
    owner: "local",
    dataset,
    state: {
      ...initialState(dataset),
      draft: { teamA: "1", teamB: "2", give: ["1"], get: ["2"] },
    },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  await page.route("https://a.espncdn.com/**", (route) => route.abort());
  await page.goto("./");
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("fantasy-football-lab", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("current");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(value, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, w);
  await page.reload();
  return w;
}

// Import preview, reload, counter direction and profile persistence all use the real local journal repository.
test("imports documented offers privately and retains outcomes/profiles on reload", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("link", { name: "Trade journal", exact: true }).click();
  const data = journalFromTables(
    [
      {
        OfferID: "A",
        NegotiationID: "N",
        Season: 2026,
        NFLWeek: 7,
        ProposerTeamID: 1,
        Proposer: "Synthetic one",
        RecipientTeamID: 2,
        Recipient: "Synthetic two",
        Outcome: "Rejected",
      },
    ],
    [
      {
        OfferID: "A",
        Side: "Offered",
        PlayerID: 1,
        Player: "Synthetic offered",
      },
      {
        OfferID: "A",
        Side: "Requested",
        PlayerID: 2,
        Player: "Synthetic requested",
      },
    ],
  );
  await page.locator('input[type="file"][accept=".json,.xlsx"]').setInputFiles({
    name: "synthetic-journal.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(data)),
  });
  await expect(page.getByText(/Import 1 records/)).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm import", exact: true })
    .click();
  await expect(
    page.getByRole("cell", {
      name: "Synthetic offered → Synthetic requested",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", {
      name: "Outcome for documented:2026:A",
      exact: true,
    })
    .selectOption("accepted");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();
  const profile = page
    .locator("details")
    .filter({ has: page.locator("summary").filter({ hasText: /^Chain B ·/ }) })
    .first();
  await profile.locator("summary").first().click();
  await profile
    .getByRole("combobox", { name: "Default negotiating preset", exact: true })
    .selectOption("3");
  await expect(profile.locator("summary").first()).toContainText(
    "Modest discount",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", {
      name: "Outcome for documented:2026:A",
      exact: true,
    }),
  ).toHaveValue("accepted");
  await expect(
    page.locator("summary").filter({ hasText: /^Chain B · Modest discount/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create counter", exact: true })
    .click();
  await page.getByText("Create linked counteroffer", { exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Proposer", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Recipient", exact: true }),
  ).toHaveValue("1");
});

// The new opt-in starts off independently and logging is explicit; no search or save action silently creates outcomes.
test("keeps direct/search toggles independent and freezes an explicitly logged forecast", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("link", { name: "Trade analyzer", exact: true }).click();
  const toggles = page.getByRole("checkbox", {
    name: "Enable Surface Trading",
    exact: true,
  });
  await expect(toggles).toHaveCount(2);
  await expect(toggles.nth(0)).not.toBeChecked();
  await expect(toggles.nth(1)).not.toBeChecked();
  await toggles.nth(0).check();
  await expect(toggles.nth(1)).not.toBeChecked();
  const assessment = page.getByRole("region", {
    name: "Manager expectations assessment",
    exact: true,
  });
  await expect(assessment).toBeVisible();
  await assessment.getByText("Why this estimate?", { exact: true }).click();
  await expect(
    assessment.getByRole("cell", { name: /Preferred net gain/ }),
  ).toBeVisible();
  await assessment
    .getByRole("button", { name: "Log offer + original forecast", exact: true })
    .click();
  await expect(assessment.getByRole("status")).toContainText(
    "original forecast logged",
  );
  await page.getByRole("link", { name: "Trade journal", exact: true }).click();
  await page.getByText("Record / forecasts", { exact: true }).click();
  const forecast = page
    .locator("summary")
    .filter({ hasText: /^prospective forecast/ });
  await expect(forecast).toBeVisible();
  await forecast.click();
  await expect(
    page.locator("pre").filter({ hasText: '"privateImpact"' }),
  ).toContainText('"surface-manager-1"');
  await page.reload();
  await page.getByText("Record / forecasts", { exact: true }).click();
  await expect(
    page.locator("summary").filter({ hasText: /^prospective forecast/ }),
  ).toBeVisible();
});

// Exercise IndexedDB transactions and real sync code with a synthetic JSONB/revision server; no live account is contacted.
test("avoids false sync conflicts and preserves explicit conflict choices and immutable forecasts", async ({
  page,
}) => {
  await seed(page);
  // Bundle the real storage module in memory for this test only; compiled previews do not serve development /src URLs.
  const bundle = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: "src/storage/negotiations.ts",
        name: "NegotiationSyncTest",
        formats: ["iife"],
      },
    },
  });
  const result = Array.isArray(bundle) ? bundle[0] : bundle;
  if (!("output" in result)) throw Error("Expected an in-memory test bundle");
  const script = result.output.find((file) => file.type === "chunk");
  if (!script) throw Error("Missing storage test bundle");
  await page.addScriptTag({ content: script.code });
  const report = await page.evaluate(async () => {
    // This isolated browser global exists only in the injected test bundle, never in the deployed application.
    const mod = (window as any).NegotiationSyncTest;
    const entry = {
      id: "synthetic-offer",
      kind: "offer",
      payload: {
        negotiation: "n",
        season: "2026",
        week: 7,
        recordedUTC: "2026-10-29T00:00:00.000Z",
        date: "",
        draft: { teamA: "1", teamB: "2", give: ["1"], get: ["2"] },
        names: { "2": "B", "1": "A" },
        teamNames: { "2": "Team B", "1": "Team A" },
        outcome: "pending",
        responseActor: "2",
        provenance: "prospective",
        recipientIsUser: false,
        notes: "",
        responses: [],
      },
    };
    await mod.putNegotiations("local", [entry]);
    const reverse = (value: any): any =>
      Array.isArray(value)
        ? value.map(reverse)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .reverse()
                .map(([key, item]) => [key, reverse(item)]),
            )
          : value;
    let remote = {
      record_id: entry.id,
      kind: entry.kind,
      payload: reverse(entry.payload),
      revision: 1,
      request_id: crypto.randomUUID(),
    };
    const rpc = async (name: string, args: any) => {
      if (args.p_owner !== "local") throw Error("Incorrect intended account");
      if (name === "get_fantasy_negotiations")
        return { data: [structuredClone(remote)], error: null };
      if (args.p_expected_revision !== remote.revision)
        return { data: null, error: { message: "CONFLICT_NEGOTIATION" } };
      remote = {
        ...remote,
        payload: reverse(args.p_payload),
        revision: remote.revision + 1,
        request_id: args.p_request_id,
      };
      return { data: [structuredClone(remote)], error: null };
    };
    const first = await mod.syncNegotiations("local", { rpc });
    const acknowledged = (await mod.readNegotiations("local"))[0];
    await mod.putNegotiations("local", [
      { ...entry, payload: { ...entry.payload, notes: "Local note" } },
    ]);
    remote = {
      ...remote,
      payload: { ...remote.payload, notes: "Cloud note" },
      revision: 2,
    };
    const conflicts = await mod.syncNegotiations("local", { rpc });
    await mod.resolveNegotiation("local", conflicts[0], true);
    const resolved = await mod.syncNegotiations("local", { rpc });
    const saved = (await mod.readNegotiations("local"))[0];
    const forecast = {
      id: "immutable",
      kind: "forecast",
      payload: {
        offer: entry.id,
        recordedUTC: entry.payload.recordedUTC,
        draft: entry.payload.draft,
        origin: "prospective",
        context: "synthetic",
        settings: "{}",
        names: {},
        rosters: { before: [], after: [], drops: [] },
        assessment: {
          version: "surface-manager-1",
          status: "eligible",
          preset: 2,
          sourceUTC: null,
          datasetHash: "synthetic",
          season: "2026",
          week: 7,
          matches: [],
          preferred: 2,
          reasons: [],
          warnings: [],
          evidence: [],
          band: 0,
          range: [15, 45],
        },
      },
    };
    await mod.putNegotiations("local", [forecast]);
    let immutableRejected = false;
    try {
      await mod.putNegotiations("local", [
        { ...entry, id: "should-not-save" },
        { ...forecast, payload: { ...forecast.payload, context: "rewritten" } },
      ]);
    } catch {
      immutableRejected = true;
    }
    const after = await mod.readNegotiations("local");
    return {
      firstConflicts: first.length,
      acknowledged: !acknowledged.dirty,
      realConflicts: conflicts.length,
      resolved: resolved.length,
      notes: saved.entry.payload.notes,
      revision: saved.revision,
      immutableRejected,
      atomic: !after.some((r: any) => r.entry.id === "should-not-save"),
    };
  });
  expect(report).toEqual({
    firstConflicts: 0,
    acknowledged: true,
    realConflicts: 1,
    resolved: 0,
    notes: "Local note",
    revision: 3,
    immutableRejected: true,
    atomic: true,
  });
});
