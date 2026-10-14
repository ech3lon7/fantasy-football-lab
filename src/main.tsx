import React from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import "./ui/styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
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
