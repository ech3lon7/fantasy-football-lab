import { describe, expect, it } from "vitest";
// @ts-expect-error The deployment script runs directly in Node without TS declarations.
import { verifyPages } from "../scripts/verify-pages.mjs";

// Synthetic responses isolate publication failures without accessing a real deployment.
const site = "https://example.test/fantasy-football-lab/";
const html =
  '<div id="root"></div><script type="module" src="/fantasy-football-lab/assets/app.js"></script><link rel="stylesheet" href="/fantasy-football-lab/assets/app.css">';
function fixture(overrides: Record<string, [string, string, number]> = {}) {
  const responses: Record<string, [string, string, number]> = {
    "/fantasy-football-lab/index.html": [html, "text/html", 200],
    "/fantasy-football-lab/assets/app.js": [
      'console.log("bc12e9f")',
      "text/javascript",
      200,
    ],
    "/fantasy-football-lab/assets/app.css": [
      "body { color: black }",
      "text/css",
      200,
    ],
    ...overrides,
  };
  return async (url: URL) => {
    const [body, type, status] = responses[url.pathname] ?? [
      "missing",
      "text/plain",
      404,
    ];
    return new globalThis.Response(body, {
      status,
      headers: { "content-type": type },
    });
  };
}

// Successful uploads must actually serve the expected compiled release and its CSS.
describe("published Pages verification", () => {
  it("accepts the compiled app for the expected commit", async () => {
    await expect(
      verifyPages(site, "bc12e9f0123", fixture()),
    ).resolves.toBeUndefined();
  });

  it.each([
    [
      '<div id="root"></div><script type="module" src="/src/main.tsx"></script>',
      "Unbuilt source",
    ],
    ['<link href="%BASE_URL%icon.svg">', "Unbuilt source"],
    ['<div id="root"></div>', "no compiled module"],
    [html.replace('id="root"', 'id="wrong"'), "missing the app root"],
    [
      html.replace("/fantasy-football-lab/assets/app.js", "/assets/app.js"),
      "Unexpected compiled asset",
    ],
  ])("rejects incorrect published HTML: %s", async (body, reason) => {
    await expect(
      verifyPages(
        site,
        "",
        fixture({
          "/fantasy-football-lab/index.html": [body, "text/html", 200],
        }),
      ),
    ).rejects.toThrow(reason);
  });

  it.each([
    ["app.js", "missing", "text/plain", 404, "HTTP 404"],
    ["app.js", "<!doctype html>", "text/html", 200, "Missing compiled asset"],
    ["app.css", "missing", "text/plain", 404, "HTTP 404"],
    [
      "app.js",
      'console.log("older")',
      "text/javascript",
      200,
      "different commit",
    ],
  ] as const)(
    "rejects unavailable or stale %s",
    async (asset, body, type, status, reason) => {
      await expect(
        verifyPages(
          site,
          "bc12e9f",
          fixture({
            [`/fantasy-football-lab/assets/${asset}`]: [body, type, status],
          }),
        ),
      ).rejects.toThrow(reason);
    },
  );
});
