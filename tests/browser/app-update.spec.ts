import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import {
  initialState,
  type Dataset,
  type Workspace,
} from "../../src/domain/contracts";

// Serve two virtual releases of the real build without editing dist, publishing, or using real league data.
let server: Server,
  origin: string,
  base: string,
  release = "a",
  missingEntry = false;
let index: string, worker: string, entryPath: string, entry: Buffer;
const assets = new Map<string, Buffer>();
const entryFor = (version: string) =>
  `${base}assets/index-release-${version}.js`;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  index = await readFile("dist/index.html", "utf8");
  worker = await readFile("dist/sw.js", "utf8");
  entryPath = index.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)![1];
  base = entryPath.slice(0, entryPath.indexOf("assets/"));
  entry = await readFile(`dist/${entryPath.slice(base.length)}`);
  for (const name of await readdir("dist/assets"))
    assets.set(`${base}assets/${name}`, await readFile(`dist/assets/${name}`));
  for (const name of ["icon.svg", "manifest.webmanifest"])
    assets.set(`${base}${name}`, await readFile(`dist/${name}`));
  server = createServer(async (request, response) => {
    // Deliberately remove the previous entry on deployment, matching static-host asset replacement.
    const url = new URL(request.url!, "http://localhost");
    const send = (type: string, body: string | Buffer, status = 200) => {
      response.writeHead(status, {
        "Content-Type": type,
        "Cache-Control": "no-store",
      });
      response.end(body);
    };
    if (url.pathname === base || url.pathname === `${base}index.html`) {
      send(
        "text/html",
        index.replaceAll(
          entryPath,
          entryFor(url.searchParams.has("legacy-html") ? "a" : release),
        ),
      );
    } else if (url.pathname === `${base}sw.js`) {
      if (release === "a") {
        // Model the deployed legacy worker so migration, not just new-to-new updates, is exercised.
        const files = [
          "./",
          "index.html",
          "icon.svg",
          "manifest.webmanifest",
          ...[...assets.keys()]
            .filter((p) => p.includes("/assets/"))
            .map((p) =>
              p === entryPath
                ? entryFor("a").slice(base.length)
                : p.slice(base.length),
            ),
        ];
        send(
          "text/javascript",
          `const CACHE='fantasy-lab-100',FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES))));
self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fantasy-lab-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url),s=new URL(self.registration.scope);if(e.request.method!=='GET'||u.origin!==s.origin||!u.pathname.startsWith(s.pathname)||(!u.pathname.endsWith('/')&&!FILES.some(f=>new URL(f,s).pathname===u.pathname)))return;e.respondWith(caches.open(CACHE).then(c=>c.match(e.request)).then(c=>c||fetch(e.request)))});`,
        );
      } else
        send(
          "text/javascript",
          worker.replaceAll(
            entryPath.slice(base.length),
            entryFor("b").slice(base.length),
          ),
        );
    } else if (url.pathname === entryFor(release) && !missingEntry)
      send("text/javascript", entry);
    else if (assets.has(url.pathname) && url.pathname !== entryPath)
      send(
        url.pathname.endsWith(".css")
          ? "text/css"
          : url.pathname.endsWith(".js")
            ? "text/javascript"
            : url.pathname.endsWith(".svg")
              ? "image/svg+xml"
              : "application/manifest+json",
        assets.get(url.pathname)!,
      );
    else if (url.pathname === "/other/sw.js")
      send(
        "text/javascript",
        "self.addEventListener('install',()=>self.skipWaiting());",
      );
    else send("text/plain", "Missing deployment asset", 404);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Local update test server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
test.beforeEach(() => {
  release = "a";
  missingEntry = false;
});

// Keep a real, valid synthetic workspace in the same IndexedDB store the application normally uses.
async function seedSavedData(page: Page) {
  const d: Dataset = JSON.parse(
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
  const workspace: Workspace = {
    owner: "local",
    dataset: d,
    state: { ...initialState(d), filters: { recoveryMarker: "keep-my-data" } },
    datasetRevision: 0,
    stateRevision: 0,
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  await page.evaluate(async (value) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("current");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("current", "readwrite");
      tx.objectStore("current").put(value, "local");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem("recovery-session-marker", "keep-my-session");
  }, workspace);
}

// A new worker must serve old immutable assets to another tab even after the host removed those files.
test("updates retain legacy-tab assets, fetch fresh HTML, and remain usable offline", async ({
  page,
  context,
}) => {
  await page.goto(`${origin}${base}`);
  await expect(
    page.getByRole("heading", { name: "Your roster, in focus." }),
  ).toBeVisible();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const oldTab = await context.newPage();
  await oldTab.goto(`${origin}${base}`);
  release = "b";
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration!.update();
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          !!(await navigator.serviceWorker.getRegistration())?.waiting,
      ),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => resolve(),
        { once: true },
      );
      registration!.waiting!.postMessage("SKIP_WAITING");
    });
  });
  expect(
    (await context.request.get(`${origin}${entryFor("a")}`)).status(),
  ).toBe(404);
  const retained = await oldTab.evaluate(
    async (url) => (await fetch(url)).status,
    `${origin}${entryFor("a")}`,
  );
  expect(retained).toBe(200);
  // Simulate stale HTTP HTML reaching the new worker: its old entry must still be loadable.
  await oldTab.goto(`${origin}${base}?legacy-html=1`);
  await expect(
    oldTab.getByRole("heading", { name: "Your roster, in focus." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute(
    "src",
    entryFor("b"),
  );
  await expect(
    page.getByRole("heading", { name: "Your roster, in focus." }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your roster, in focus." }),
  ).toBeVisible();
  await context.setOffline(false);
});

// Missing JavaScript must expose recovery before React runs, including a safe retry during an incomplete deployment.
test("failed startup recovers without deleting workspace, sign-in storage or other app registrations", async ({
  page,
}) => {
  release = "b";
  missingEntry = true;
  await page.goto(`${origin}${base}?kept=yes#/gems`);
  await expect(
    page.getByRole("heading", { name: "App couldn't finish loading" }),
  ).toBeVisible();
  await seedSavedData(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/other/sw.js", {
      scope: "/other/",
    });
  });
  await page.getByRole("button", { name: "Reload latest app" }).click();
  await expect(page.getByText(/latest app isn't reachable yet/)).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("recovery-session-marker")),
  ).toBe("keep-my-session");
  missingEntry = false;
  await page.getByRole("button", { name: "Reload latest app" }).click();
  await expect(
    page.getByRole("heading", { name: "Gem filters", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("kept")).toBe("yes");
  expect(new URL(page.url()).searchParams.has("__fantasy_recover")).toBe(false);
  expect(
    await page.evaluate(() => localStorage.getItem("recovery-session-marker")),
  ).toBe("keep-my-session");
  expect(
    await page.evaluate(
      async () => !!(await navigator.serviceWorker.getRegistration("/other/")),
    ),
  ).toBe(true);
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("fantasy-football-lab", 1);
      request.onsuccess = () => resolve(request.result);
    });
    const value = await new Promise<any>((resolve) => {
      const request = db
        .transaction("current")
        .objectStore("current")
        .get("local");
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return {
      hash: value.dataset.hash,
      marker: value.state.filters.recoveryMarker,
    };
  });
  expect(saved.hash).toBeTruthy();
  expect(saved.marker).toBe("keep-my-data");
});

// The regular update banner must also recover safely, even though its worker was installed by a previous release.
test("the update action loads the latest release without hanging on controllerchange", async ({
  page,
}) => {
  await page.goto(`${origin}${base}`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  release = "b";
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect(
    page.getByText("An app update is ready.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reload app", exact: true }).click();
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute(
    "src",
    entryFor("b"),
  );
  await expect(
    page.getByRole("heading", { name: "Your roster, in focus." }),
  ).toBeVisible();
  // Re-registering the offline worker after recovery is not another app release.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(
    page.getByText("An app update is ready.", { exact: false }),
  ).toHaveCount(0);
  await page.reload();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(
    page.getByText("An app update is ready.", { exact: false }),
  ).toHaveCount(0);
});

// Fresh HTML may already contain the current release while an older offline controller still owns the tab.
test("current app silently adopts its waiting worker instead of repeatedly asking to reload", async ({
  page,
}) => {
  await page.goto(`${origin}${base}`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await seedSavedData(page);
  release = "b";
  await page.goto(`${origin}${base}?fresh-entry=1`);
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute(
    "src",
    entryFor("b"),
  );
  await page.waitForFunction(
    () => document.getElementById("app-startup")?.hidden,
  );
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())!.update();
  });
  await expect
    .poll(() =>
      page.evaluate(
        async (url) => !!(await caches.match(url)),
        `${origin}${entryFor("b")}`,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return !!reg?.active && !reg.installing && !reg.waiting;
      }),
    )
    .toBe(true);
  await expect(
    page.getByText("An app update is ready.", { exact: false }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText("An app update is ready.", { exact: false }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("recovery-session-marker")),
  ).toBe("keep-my-session");
});
