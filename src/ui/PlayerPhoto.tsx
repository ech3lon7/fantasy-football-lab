import { useState, type CSSProperties } from "react";
import { teamColors } from "../domain/view/nfl-colors";

export interface PlayerLike {
  id: string | number;
  name: string;
  pos?: string;
  nfl?: string;
}

export type PhotoSize = number | "sm" | "md" | "lg" | "xl";

const sizeMap: Record<"sm" | "md" | "lg" | "xl", number> = {
  sm: 24,
  md: 32,
  lg: 48,
  xl: 72,
};

// Derive two-letter initials for a player, using the NFL abbreviation for team defenses.
export function playerInitials(name: string, pos?: string, nfl?: string): string {
  if (pos === "D/ST" && nfl) return nfl.slice(0, 3).toUpperCase();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Single PlayerPhoto component used across the application.
// Always renders fixed dimensions with team colour behind, lazy loading ESPN headshot, and initials on fallback.
export function PlayerPhoto({
  player,
  size = "md",
  className,
}: {
  player: PlayerLike;
  size?: PhotoSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const px = typeof size === "number" ? size : sizeMap[size] ?? 32;
  const colors = teamColors(player.nfl ?? "");
  const numericId = Number(player.id);
  const canHaveHeadshot = !isNaN(numericId) && numericId > 0 && player.pos !== "D/ST";
  const initials = playerInitials(player.name, player.pos, player.nfl);

  const style: CSSProperties = {
    width: `${px}px`,
    height: `${px}px`,
    minWidth: `${px}px`,
    maxWidth: `${px}px`,
    borderRadius: "999px",
    background: colors.background,
    color: colors.ink,
    fontSize: `${Math.max(10, Math.round(px * 0.4))}px`,
    lineHeight: 1,
    fontWeight: 700,
    display: "inline-grid",
    placeItems: "center",
    overflow: "hidden",
    flexShrink: 0,
    userSelect: "none",
  };

  return (
    <span
      className={`gd-photo${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
      title={`${player.name}${player.nfl ? ` · ${player.nfl}` : ""}`}
    >
      {canHaveHeadshot && !failed ? (
        <img
          src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        <span className="gd-photo-fallback">{initials}</span>
      )}
    </span>
  );
}
