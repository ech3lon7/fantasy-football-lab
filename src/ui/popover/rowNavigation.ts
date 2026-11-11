import { useEffect } from "react";
import { isEditableTarget, nextRowIndex } from "./keys";

// Mark a list row with data-player-row; Up and Down then move focus between rows and Enter opens the row's player link.
export function usePlayerRowKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      const target = e.target as HTMLElement | null;
      if (!target || isEditableTarget(target)) return;
      // Arrow keys belong to an open popover or listbox before any list behind it.
      if (target.closest('[role="dialog"], [role="listbox"]')) return;
      const row = target.closest<HTMLElement>("[data-player-row]");
      if (!row) return;
      const rows = [
        ...(row.parentElement?.querySelectorAll<HTMLElement>(
          ":scope > [data-player-row]",
        ) ?? []),
      ];
      const at = rows.indexOf(row);
      const to = nextRowIndex(at, rows.length, e.key);
      if (to === at || to < 0) return;
      e.preventDefault();
      // Keep focus in the same kind of control so the keyboard path stays predictable.
      rows[to]
        .querySelector<HTMLElement>("a.player-link, a.player-name, a[href], button")
        ?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
