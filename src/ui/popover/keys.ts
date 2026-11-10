// Pure keyboard rules shared by the popover stack and player lists, kept apart from the DOM so each rule is testable.

// Move Tab focus inside a popover, wrapping at both ends; -1 means focus is outside the popover's controls.
export function trapIndex(
  current: number,
  count: number,
  backwards: boolean,
): number {
  if (count <= 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? -1 : 1) + count) % count;
}

// Up and Down stop at the first and last row instead of wrapping, so a list's ends stay predictable.
export function nextRowIndex(
  current: number,
  count: number,
  key: string,
): number {
  if (count <= 0) return -1;
  if (current < 0) return key === "ArrowUp" ? count - 1 : 0;
  const next = current + (key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0);
  return Math.min(count - 1, Math.max(0, next));
}

// List arrows must never steal keys from fields that use them (text boxes, selects, sliders, editable text).
export function isEditableTarget(el: {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}): boolean {
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.("role");
  return role === "slider" || role === "textbox" || role === "combobox";
}

// Selector for controls a person can Tab to inside a popover.
export const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");
