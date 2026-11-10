import { useEffect } from "react";
import { readThemePref, themeKey, writeThemePref } from "./theme";

// Store each Feel setting in the existing string-valued filter record so it syncs with the account.
export const animationKey = "feelAnimation";
export const soundKey = "feelSound";
export const hapticsKey = "feelHaptics";

export const animationPrefs = ["system", "full", "reduced", "off"] as const;
export type AnimationPref = (typeof animationPrefs)[number];
export type AnimationLevel = "full" | "reduced" | "off";

// Treat unknown saved values as System so a bad value never disables or forces motion.
export const readAnimationPref = (raw?: string): AnimationPref =>
  animationPrefs.find((x) => x === raw) ?? "system";
export const writeAnimationPref = (pref: AnimationPref): string =>
  pref === "system" ? "" : pref;

// System follows the device's reduced-motion request; explicit choices always win.
export const resolveAnimation = (
  pref: AnimationPref,
  prefersReduced: boolean,
): AnimationLevel =>
  pref === "system" ? (prefersReduced ? "reduced" : "full") : pref;

// Sound and haptics are off unless explicitly turned on.
export const readFlag = (raw?: string): boolean => raw === "on";
export const writeFlag = (on: boolean): string => (on ? "on" : "");

// The Vibration API is missing on some devices (for example iOS Safari), so support is checked, never assumed.
export const hapticsSupported = (
  nav: { vibrate?: unknown } | undefined = typeof navigator === "undefined"
    ? undefined
    : navigator,
): boolean => typeof nav?.vibrate === "function";

export type FeedbackKind = "tap" | "select" | "success" | "caution";

// Short tones in hertz and milliseconds per kind; kept as data so tests can pin them.
export const toneFor = (kind: FeedbackKind): { hz: number; ms: number }[] =>
  ({
    tap: [{ hz: 520, ms: 40 }],
    select: [{ hz: 660, ms: 60 }],
    success: [
      { hz: 520, ms: 70 },
      { hz: 780, ms: 110 },
    ],
    caution: [
      { hz: 330, ms: 90 },
      { hz: 260, ms: 140 },
    ],
  })[kind];

// Short vibration patterns in milliseconds per kind.
export const vibrationFor = (kind: FeedbackKind): number[] =>
  ({
    tap: [10],
    select: [15],
    success: [15, 40, 25],
    caution: [40, 60, 40],
  })[kind];

let audio: AudioContext | undefined;
// Play the kind's tone only when Sound is on; failures are ignored because feedback is never essential.
function playTone(kind: FeedbackKind) {
  try {
    const Context =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    let at = audio.currentTime;
    for (const { hz, ms } of toneFor(kind)) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.05, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + ms / 1000);
      at += ms / 1000;
    }
  } catch {
    // Audio can be blocked until a user gesture; skip silently.
  }
}

// One entry point for tap, select, success and caution feedback; each channel is independent.
export function feedback(
  kind: FeedbackKind,
  settings: { sound: boolean; haptics: boolean },
) {
  if (settings.sound) playTone(kind);
  if (settings.haptics && hapticsSupported())
    try {
      navigator.vibrate(vibrationFor(kind));
    } catch {
      // Vibration can be refused by the browser; skip silently.
    }
}

// Expose the effective animation level on the root so every transition can be gated on one attribute.
export function useAnimationRoot(enabled: boolean, pref: AnimationPref) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      delete root.dataset.animation;
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      root.dataset.animation = resolveAnimation(pref, query.matches);
    };
    apply();
    query.addEventListener("change", apply);
    return () => {
      query.removeEventListener("change", apply);
      delete root.dataset.animation;
    };
  }, [enabled, pref]);
}

// Translate a Feel menu change into the filter key and stored string it saves, so the shell stays free of storage details.
export function feelEntry(
  key: "theme" | "animation" | "sound" | "haptics",
  value: string,
): [string, string] {
  if (key === "theme") return [themeKey, writeThemePref(readThemePref(value))];
  if (key === "animation")
    return [animationKey, writeAnimationPref(readAnimationPref(value))];
  return [key === "sound" ? soundKey : hapticsKey, writeFlag(readFlag(value))];
}
