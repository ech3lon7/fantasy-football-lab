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
      `// Scope this cache to this app path; keep earlier builds available to tabs still running them.
const PREFIX='fantasy-lab-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE=PREFIX+${JSON.stringify(version)},FILES=${JSON.stringify(names)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(file=>new Request(new URL(file,self.registration.scope),{cache:'reload'}))))));
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});
// Activation must not remove the old entry scripts or workers before existing tabs finish using them.
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  if(event.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  // Fresh HTML discovers a deployment online; offline fallback stays paired with this build's cached assets.
  if(event.request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===scope.pathname+'index.html')){
    event.respondWith(fetch(new Request(event.request,{cache:'no-store'})).then(response=>{
      if(!response.ok)throw Error('Navigation unavailable');
      return response;
    }).catch(()=>caches.open(CACHE).then(cache=>cache.match(new URL('index.html',scope))).then(cached=>cached||Response.error())));
    return;
  }
  if(!url.pathname.startsWith(scope.pathname+'assets/')&&!FILES.some(file=>new URL(file,scope).pathname===url.pathname))return;
  // Check retained app caches for an older immutable asset before asking a server that may have removed it.
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(async cached=>{
    if(cached)return cached;
    const keys=await caches.keys();
    for(const key of keys.filter(key=>key.startsWith(PREFIX)||/^fantasy-lab-[0-9]+$/.test(key))){
      const prior=await caches.open(key),match=await prior.match(event.request);
      if(match)return match;
    }
    return fetch(event.request);
  }));
});`,
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
