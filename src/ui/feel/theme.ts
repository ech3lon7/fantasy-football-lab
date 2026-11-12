import { useEffect, useState } from "react";

// Store the theme choice in the existing string-valued filter record so it syncs with the account.
export const themeKey = "feelTheme";
export const themePrefs = ["system", "light", "dark"] as const;
export type ThemePref = (typeof themePrefs)[number];
export type ResolvedTheme = "light" | "dark";

// Treat anything unrecognized as System so a bad saved value never locks the interface into one theme.
export const readThemePref = (raw?: string): ThemePref =>
  themePrefs.find((x) => x === raw) ?? "system";

// Save System as an empty string so the default leaves no stored value.
export const writeThemePref = (pref: ThemePref): string =>
  pref === "system" ? "" : pref;

// System follows the device; an explicit choice always wins.
export const resolveTheme = (
  pref: ThemePref,
  systemDark: boolean,
): ResolvedTheme =>
  pref === "system" ? (systemDark ? "dark" : "light") : pref;

// Mark the document root with the interface marker and the resolved theme.
export function useGamedayRoot(pref: ThemePref) {
  useEffect(() => {
    const root = document.documentElement;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.gameday = "";
      root.dataset.theme = resolveTheme(pref, query.matches);
    };
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      delete root.dataset.gameday;
      delete root.dataset.theme;
    };
  }, [pref]);
}

// The theme actually shown, so a one-tap switch can name the theme it moves to.
export function useResolvedTheme(pref: ThemePref): ResolvedTheme {
  const query = () =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [resolved, setResolved] = useState(() =>
    resolveTheme(pref, query()),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolved(resolveTheme(pref, media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [pref]);
  return resolved;
}

