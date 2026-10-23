import { URL, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Check the public build rather than trusting a successful upload of some HTML.
export async function verifyPages(
  site,
  commit = "",
  fetcher = globalThis.fetch,
) {
  const base = new URL(site);
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const probe = Date.now().toString();
  async function read(url) {
    const request = new URL(url);
    request.searchParams.set("__deployment_check", probe);
    const response = await fetcher(request, {
      cache: "no-store",
      signal: globalThis.AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}: ${url}`);
    return {
      text: await response.text(),
      type: response.headers.get("content-type") ?? "",
    };
  }

  // Unresolved Vite placeholders or source entries identify the competing Jekyll publication.
  const { text: html } = await read(new URL("index.html", base));
  if (html.includes("%BASE_URL%") || /src=["'][^"']*\/src\//i.test(html))
    throw Error(
      "Unbuilt source is published. Set Pages Source to GitHub Actions and rerun Verify and deploy.",
    );
  if (!/id=["']root["']/.test(html))
    throw Error("Published HTML is missing the app root.");
  const entries = [
    ...html.matchAll(
      /<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/gi,
    ),
  ];
  if (!entries.length)
    throw Error("Published HTML has no compiled module entry.");
  const styles = [
    ...html.matchAll(
      /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["']/gi,
    ),
  ];

  // Entry JS and CSS must belong to this app and resolve to assets, never an HTML fallback.
  for (const [index, match] of [...entries, ...styles].entries()) {
    const asset = new URL(match[1], base);
    if (
      asset.origin !== base.origin ||
      !asset.pathname.startsWith(`${base.pathname}assets/`)
    )
      throw Error(`Unexpected compiled asset path: ${asset}`);
    const { text, type } = await read(asset);
    if (
      !text.trim() ||
      /text\/html/i.test(type) ||
      /^\s*(?:<!doctype|<html)/i.test(text)
    )
      throw Error(`Missing compiled asset: ${asset}`);
    if (index === 0 && commit && !text.includes(commit.slice(0, 7)))
      throw Error("The public entry script is from a different commit.");
  }
}

// Allow a short CDN propagation window, then fail deployment visibly with the last diagnosis.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let failure;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      await verifyPages(process.argv[2], process.argv[3]);
      console.log("Published compiled app and entry assets verified.");
      failure = undefined;
      break;
    } catch (error) {
      failure = error;
      console.warn(error.message);
      if (attempt < 5) await delay(10000);
    }
  }
  if (failure) {
    console.error(`::error::${failure.message}`);
    process.exitCode = 1;
  }
}
