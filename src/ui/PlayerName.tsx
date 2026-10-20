import { createContext, useContext, useId, type ReactNode } from "react";
import type { Player } from "../domain/valuation";

// Share one inspection surface while preserving normal profile links and modified clicks.
export const PlayerPopoverContext = createContext<{
  activeTrigger: string | null;
  open: (id: string, anchor: HTMLElement, trigger: string) => void;
} | null>(null);

// Ordinary clicks inspect a player; opening the link in another tab still opens the full profile.
export function PlayerName({
  p,
  children,
  className = "player-name",
}: {
  p: Player;
  children?: ReactNode;
  className?: string;
}) {
  const context = useContext(PlayerPopoverContext),
    trigger = useId();
  const expanded = context?.activeTrigger === trigger;
  return (
    <a
      className={className}
      href={`#/player/${p.id}`}
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
        context.open(p.id, event.currentTarget, trigger);
      }}
    >
      {children ?? p.name}
    </a>
  );
}
