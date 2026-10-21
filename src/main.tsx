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
        const offer = () =>
          window.dispatchEvent(new Event("fantasy-update-ready"));
        if (reg.waiting) offer();
        reg.onupdatefound = () => {
          const next = reg.installing;
          if (next)
            next.onstatechange = () => {
              if (
                next.state === "installed" &&
                navigator.serviceWorker.controller
              )
                offer();
            };
        };
      })
      .catch(() => {
        /* Offline shell is optional; local data remains in IndexedDB. */
      });
  });
}
