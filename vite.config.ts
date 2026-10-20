import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import packageInfo from "./package.json" with { type: "json" };
// Stamp the package release and a unique published build into the compiled app.
const release = {
  version: packageInfo.version,
  build: process.env.GITHUB_RUN_NUMBER ?? "local",
  commit: process.env.GITHUB_SHA?.slice(0, 7) ?? "local",
  builtAt: new Date().toISOString(),
};
const offlineShell = () => ({
  name: "offline-shell",
  closeBundle() {
    const names = [
      "./",
      "index.html",
      "icon.svg",
      "manifest.webmanifest",
      ...fs.readdirSync("dist/assets").map((n) => `assets/${n}`),
    ];
    const version = `fantasy-lab-${Date.now()}`;
    fs.writeFileSync(
      "dist/sw.js",
      `const CACHE=${JSON.stringify(version)},FILES=${JSON.stringify(names)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES))));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('fantasy-lab-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url),scope=new URL(self.registration.scope);if(event.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)||(!url.pathname.endsWith('/')&&!FILES.some(f=>new URL(f,scope).pathname===url.pathname)))return;event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(cached=>cached||fetch(event.request)));});`,
    );
  },
});
export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(release.version),
    "import.meta.env.VITE_APP_BUILD": JSON.stringify(release.build),
    "import.meta.env.VITE_APP_COMMIT": JSON.stringify(release.commit),
    "import.meta.env.VITE_APP_BUILT_AT": JSON.stringify(release.builtAt),
  },
  plugins: [react(), offlineShell()],
  base: process.env.GITHUB_ACTIONS ? "/fantasy-football-lab/" : "/",
  test: { include: ["tests/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
