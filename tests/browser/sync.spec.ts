import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Exercise the real Supabase client and IndexedDB with a synthetic session and intercepted RPCs only.
async function seedCloud(page: Page) {
  const dataset: Dataset = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "import {fixture} from './tests/fixtures.ts';process.stdout.write(JSON.stringify(await fixture()));",
      ],
      { encoding: "utf8" },
    ),
  );
  const owner = "11111111-1111-4111-8111-111111111111";
  const workspace: Workspace = {
    owner,
    dataset,
    state: initialState(dataset),
    datasetRevision: 2,
    stateRevision: 3,
    pendingDataset: false,
    pendingState: true,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  const row = {
    dataset,
    state: structuredClone(workspace.state),
    dataset_revision: 2,
    state_revision: 3,
    last_dataset_request_id: null as string | null,
    last_state_request_id: null as string | null,
  };
  let hold = false;
  let release = () => {};
  let started = () => {};
  const user = {
    id: owner,
    email: "synthetic@example.test",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  };
  await page.route("https://a.espncdn.com/**", (route) => route.abort());
  await page.route("https://synthetic-sync.supabase.co/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/auth/")) {
      await route.fulfill({ json: user });
      return;
    }
    const args = request.postDataJSON();
    if (request.url().endsWith("/get_fantasy_workspace")) {
      await route.fulfill({ json: [structuredClone(row)] });
      return;
    }
    if (!request.url().endsWith("/update_fantasy_state")) {
      await route.abort();
      return;
    }
    if (hold) {
      hold = false;
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      started();
      await wait;
    }
    if (row.last_state_request_id !== args.p_request_id) {
      if (
        row.state_revision !== args.p_expected_revision ||
        row.dataset_revision !== args.p_dataset_revision
      ) {
        await route.fulfill({
          status: 409,
          json: { message: "CONFLICT_STATE" },
        });
        return;
      }
      row.state = args.p_state;
      row.state_revision++;
      row.last_state_request_id = args.p_request_id;
    }
    await route.fulfill({ json: structuredClone(row) });
  });
  await page.goto("./");
  await page.evaluate(
    async ({ workspace, user }) => {
      const project = "synthetic-sync.supabase.co";
      const expires = Math.floor(Date.now() / 1000) + 3600;
      // A disposable local JWT-shaped token never authenticates with any actual project.
      const encode = (value: unknown) =>
        btoa(JSON.stringify(value))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
      localStorage.setItem(
        "fantasy-lab-cloud-config",
        JSON.stringify({
          url: `https://${project}`,
          key: "sb_publishable_synthetic",
        }),
      );
      localStorage.setItem(
        `fantasy-lab-${project}-auth`,
        JSON.stringify({
          access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: expires })}.synthetic`,
          refresh_token: "synthetic",
          token_type: "bearer",
          expires_at: expires,
          expires_in: 3600,
          user,
        }),
      );
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("fantasy-football-lab", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("current");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("current", "readwrite");
        tx.objectStore("current").put(workspace, workspace.owner);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    },
    { workspace, user },
  );
  await page.reload();
  await page.getByRole("link", { name: "Data & account", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sync now", exact: true }),
  ).toBeEnabled();
  return {
    row,
    owner,
    pause: () => {
      hold = true;
      return new Promise<void>((resolve) => {
        started = resolve;
      });
    },
    resume: () => release(),
  };
}

// Check durable revision metadata, rather than relying on the optimistic sync status text.
async function stored(page: Page, owner: string) {
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Workspace>((resolve, reject) => {
        const request = db
          .transaction("current")
          .objectStore("current")
          .get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, owner);
}

// Changing a saved filter mid-upload must preserve it, advance the base revision, and permit the next manual sync and reload.
test("Sync now retains in-flight edits and the next sync succeeds", async ({
  page,
}) => {
  const cloud = await seedCloud(page);
  const started = cloud.pause();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await started;
  await page.getByRole("link", { name: "Trade analyzer", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "Evaluate lineup impact using",
      exact: true,
    })
    .selectOption("marked-starters");
  await expect
    .poll(
      async () =>
        (await stored(page, cloud.owner)).state.filters.tradeLineupBasis,
    )
    .toBe("marked-starters");
  cloud.resume();
  await expect
    .poll(async () => (await stored(page, cloud.owner)).stateRevision)
    .toBe(4);
  expect((await stored(page, cloud.owner)).pendingState).toBe(true);
  await page.getByRole("link", { name: "Data & account", exact: true }).click();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect
    .poll(async () => (await stored(page, cloud.owner)).pendingState)
    .toBe(false);
  expect(cloud.row.state.filters.tradeLineupBasis).toBe("marked-starters");
  expect(cloud.row.state_revision).toBe(5);
  await expect(
    page.getByRole("heading", {
      name: "Choose your current workspace",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect
    .poll(async () => (await stored(page, cloud.owner)).stateRevision)
    .toBe(5);
  expect((await stored(page, cloud.owner)).state.filters.tradeLineupBasis).toBe(
    "marked-starters",
  );
});

// A real cloud change still presents both choices and only the user's explicit choice permits replacing it.
test("Sync now keeps genuine conflicts explicit and resolves the selected copy", async ({
  page,
}) => {
  const cloud = await seedCloud(page);
  cloud.row.state_revision = 4;
  cloud.row.state.filters = { remote: "preserve until chosen" };
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Choose your current workspace",
      exact: true,
    }),
  ).toBeVisible();
  expect(cloud.row.state.filters).toEqual({ remote: "preserve until chosen" });
  expect((await stored(page, cloud.owner)).stateRevision).toBe(3);
  await page
    .getByRole("button", {
      name: "Keep this device and replace cloud",
      exact: true,
    })
    .click();
  await expect
    .poll(async () => (await stored(page, cloud.owner)).pendingState)
    .toBe(false);
  expect(cloud.row.state.filters).toEqual({});
  await page.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Choose your current workspace",
      exact: true,
    }),
  ).toHaveCount(0);
});
