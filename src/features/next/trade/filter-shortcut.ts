import { shortcuts } from "../shortcut-list";

// Normalize a pressed modified key for storage and exact shortcut matching.
export function filterShortcut(event: KeyboardEvent): string | null {
  const modifiers = [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta"].filter(Boolean);
  if (!modifiers.length || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const key = event.code === "Space" || event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

// The keys the app's keyboard reference already gives a meaning to, read from the reference list itself so the two never drift apart.
const referenceNames: Record<string, string> = {
  Esc: "escape",
  Tab: "tab",
  "↑": "arrowup",
  "↓": "arrowdown",
  "←": "arrowleft",
  "→": "arrowright",
};
export function appUsedKeys(): Set<string> {
  const used = new Set<string>();
  for (const [label] of shortcuts)
    for (const token of label.split(/\s+/)) {
      const name = referenceNames[token];
      if (name) used.add(name);
    }
  return used;
}

// Why a pressed combination cannot be the filter wheel shortcut, or null when it can. Enter and Space alone are not accepted either.
export function filterShortcutProblem(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): string | null {
  const key = event.key.toLowerCase();
  if (appUsedKeys().has(key)) return "That key is already used by the app (see the keyboard reference). Choose another combination.";
  if (key === "enter") return "Enter is not allowed. Choose another combination.";
  if ((event.ctrlKey || event.metaKey) && ["w", "t", "n", "l", "r"].includes(key)) return "Your browser reserves that combination. Choose another one.";
  return null;
}
export const defaultFilterShortcut = "Shift+Space";
