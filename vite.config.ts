import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
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
  plugins: [react(), offlineShell()],
  base: process.env.GITHUB_ACTIONS ? "/fantasy-football-lab/" : "/",
  test: { include: ["tests/**/*.test.ts"] },
} as Parameters<typeof defineConfig>[0]);
