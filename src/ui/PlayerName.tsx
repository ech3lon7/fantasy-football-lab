import { createContext, useContext, useId, type ReactNode } from "react";
import type { Player } from "../domain/valuation";

// Share one inspection surface while preserving normal profile links and modified clicks.
export const PlayerPopoverContext = createContext<{
  activeTrigger: string | null;
  open: (
    id: string,
    anchor: HTMLElement,
    trigger: string,
    target?: "chart",
  ) => void;
} | null>(null);

export function isChartClickTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { closest?: (selector: string) => unknown };
  if (typeof candidate.closest !== "function") return false;
  return Boolean(candidate.closest(".stock-trend-pill"));
}

// Ordinary clicks inspect a player; opening the link in another tab still opens the full profile.
export function PlayerName({
  p,
  children,
  className = "player-name",
  ariaLabel,
}: {
  p: Player;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const context = useContext(PlayerPopoverContext),
    trigger = useId();
  const expanded = context?.activeTrigger === trigger;
  return (
    <a
      className={className}
      href={`#/player/${p.id}`}
      aria-label={ariaLabel}
      aria-haspopup={context ? "dialog" : undefined}
      aria-expanded={context ? expanded : undefined}
      aria-controls={expanded ? "player-popover" : undefined}
      onClick={(event) => {
        if (
          !context ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        )
          return;
        event.preventDefault();
        const isChart = isChartClickTarget(event.target);
        context.open(
          p.id,
          event.currentTarget,
          trigger,
          isChart ? "chart" : undefined,
        );
      }}
    >
      {children ?? p.name}
    </a>
  );
}
