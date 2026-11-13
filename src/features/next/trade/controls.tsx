import { cloneElement, useId, useState, type ReactElement, type ReactNode } from "react";
import type { Player } from "../../../domain/valuation";
import { PlayerPhoto } from "../../../ui/PlayerPhoto";
import { useFoldMemory } from "../limitsContext";

// A folding group of the controls panel: its title on one line and a one-line summary of its current settings on the line below.
export function Group({
  title,
  summary,
  edited = false,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  edited?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const memory = useFoldMemory();
  const [local, setLocal] = useState(defaultOpen);
  const open = memory ? memory.isOpen(title) : local;
  return (
    <details
      className="gd-fg"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        if (memory) memory.set(title, next);
        else setLocal(next);
      }}
    >
      <summary>
        <span className="gd-fg-title">{title}</span>
        <span className="gd-fs">
          {edited && (
            <span
              className="gd-edot"
              title="At least one value differs from its default"
            />
          )}
          {summary}
        </span>
      </summary>
      <div className="gd-fg-body">{children}</div>
    </details>
  );
}

// A label above one control; the control is the only child. The caption alone names the control, so the
// control's own value never becomes part of its accessible name.
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactElement<{ "aria-labelledby"?: string }>;
}) {
  const id = useId();
  return (
    <label className="gd-field">
      <span id={id}>{label}</span>
      {cloneElement(children, { "aria-labelledby": id })}
    </label>
  );
}

// A checkbox row with the text beside it and an optional count on the right.
export function Check({
  checked,
  onChange,
  children,
  count,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  count?: number | string;
  disabled?: boolean;
}) {
  return (
    <label className="gd-chk">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{children}</span>
      {count !== undefined && <span className="gd-ct">{count}</span>}
    </label>
  );
}

// A short, searchable list of players with photos; clicking a player toggles it, up to `max`.
export function PlayerPick({
  label,
  players,
  selected,
  max,
  onToggle,
  empty = "No players",
}: {
  label: string;
  players: Player[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
  empty?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = players.filter(
    (p) => !q || `${p.name} ${p.pos} ${p.nfl}`.toLowerCase().includes(q),
  );
  const full = selected.length >= max;
  return (
    <div className="gd-pick" role="group" aria-labelledby={id}>
      <span id={id} className="gd-quiet">
        {label} ({selected.length}/{max})
      </span>
      <input
        type="search"
        className="gd-sel"
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder="Search by name or position"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="gd-pick-list">
        {shown.length === 0 && <p className="gd-empty">{empty}</p>}
        {shown.map((p) => {
          const on = selected.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              className="gd-pick-item"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onToggle(p.id)}
            >
              <PlayerPhoto player={p} size={24} className="gd-photo" />
              <span>{p.name}</span>
              <small>
                {p.pos}{" "}
                {p.blendedExpected === null
                  ? "—"
                  : p.blendedExpected.toFixed(1)}
              </small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
