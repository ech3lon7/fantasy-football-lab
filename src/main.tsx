import React, { Component, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./ui/styles.css";
// Notify the independent HTML startup guard only after the application actually mounts.
function Startup() {
  useEffect(() => {
    window.dispatchEvent(new Event("fantasy-app-ready"));
  }, []);
  return <App />;
}
// Keep render exceptions from replacing the entire page with an empty React root.
class StartupBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("App render failed", error);
    window.dispatchEvent(new Event("fantasy-app-failed"));
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <StartupBoundary>
      <Startup />
    </StartupBoundary>
  </React.StrictMode>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((reg) => {
        // A waiting offline worker can belong to the bundle already running in this tab, so compare actual entry files.
        const offer = async () => {
          const waiting = reg.waiting;
          if (!waiting) return;
          try {
            const base = new URL(import.meta.env.BASE_URL, location.origin);
            const check = new URL("index.html", base);
            // A unique query bypasses old cache-first workers as well as the browser's HTTP cache.
            check.searchParams.set("__fantasy_update", Date.now().toString());
            const response = await fetch(check, {
              cache: "no-store",
              signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) return;
            const html = new DOMParser().parseFromString(
              await response.text(),
              "text/html",
            );
            const latest = html
              .querySelector<HTMLScriptElement>('script[type="module"][src]')
              ?.getAttribute("src");
            const running = document.querySelector<HTMLScriptElement>(
              'script[type="module"][src]',
            )?.src;
            if (
              !latest ||
              !running ||
              !html.getElementById("root") ||
              reg.waiting !== waiting
            )
              return;
            const entry = new URL(latest, check);
            if (
              entry.origin !== base.origin ||
              !entry.pathname.startsWith(`${base.pathname}assets/`)
            )
              return;
            if (entry.href === running) {
              // Let the same-release worker finish activating without asking the user to reload the current app again.
              window.dispatchEvent(new Event("fantasy-update-current"));
              waiting.postMessage("SKIP_WAITING");
            } else window.dispatchEvent(new Event("fantasy-update-ready"));
          } catch {
            // An offline/unverifiable deployment is not proof of a new app; retry when connectivity returns.
          }
        };
        if (reg.waiting) void offer();
        window.addEventListener("online", offer);
        reg.onupdatefound = () => {
          const next = reg.installing;
          if (next)
            next.onstatechange = () => {
              if (next.state === "installed") void offer();
            };
        };
      })
      .catch(() => {
        /* Offline shell is optional; local data remains in IndexedDB. */
      });
  });
}
