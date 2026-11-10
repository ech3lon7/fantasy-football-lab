import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  searchPlayers,
  sectionForRoute,
  sections,
  sourceFreshness,
} from "../../domain/view/shell";
import type { Model } from "../../domain/valuation";
import { KeyboardReferenceButton } from "./KeyboardReference";
import { Segmented } from "../../ui/primitives";
import {
  animationPrefs,
  feedback,
  type AnimationPref,
} from "../../ui/feel/settings";
import { themePrefs, type ThemePref } from "../../ui/feel/theme";

export interface FeelValues {
  theme: ThemePref;
  animation: AnimationPref;
  sound: boolean;
  haptics: boolean;
  // Haptics report "not supported" where the Vibration API is missing.
  hapticsSupported: boolean;
}

// Search any player by name; results come from the domain search and open the player's evaluation.
function PlayerSearch({ model }: { model: Model | null }) {
  const [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [open, setOpen] = useState(false),
    listId = useId(),
    hits = useMemo(
      () => (model ? searchPlayers(model, query) : []),
      [model, query],
    );
  function choose(index: number) {
    const hit = hits[index];
    if (!hit) return;
    setOpen(false);
    setQuery("");
    location.hash = `#/player/${hit.id}`;
  }
  return (
    <div className="gd-search">
      <input
        type="search"
        role="combobox"
        aria-label="Search any player"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined}
        placeholder="Search any player"
        value={query}
        disabled={!model}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && hits.length) {
            e.preventDefault();
            setOpen(true);
            setActive((active + 1) % hits.length);
          } else if (e.key === "ArrowUp" && hits.length) {
            e.preventDefault();
            setActive((active - 1 + hits.length) % hits.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(active);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && query.trim() && (
        <ul id={listId} role="listbox" className="gd-search-list">
          {hits.length === 0 && (
            <li className="gd-search-empty" role="presentation">
              No players match.
            </li>
          )}
          {hits.map((hit, i) => (
            <li
              key={hit.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Mouse down fires before the input's blur closes the list, so the choice is not lost.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
            >
              <span>{hit.name}</span>
              <small>
                {hit.pos} · {hit.nfl}
              </small>
              <b>{hit.eppg === null ? "—" : hit.eppg.toFixed(1)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The Feel menu holds the four independent settings: theme, animation, sound and haptics.
function FeelMenu({
  feel,
  change,
}: {
  feel: FeelValues;
  change: (
    key: "theme" | "animation" | "sound" | "haptics",
    value: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const settings = { sound: feel.sound, haptics: feel.haptics };
  return (
    <div className="gd-feel" ref={ref}>
      <button
        type="button"
        className="gd-pill"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Feel
      </button>
      {open && (
        <div className="gd-menu" role="group" aria-label="Feel settings">
          <h2>Theme</h2>
          <Segmented
            label="Theme"
            options={themePrefs}
            value={feel.theme}
            onChange={(v) => change("theme", v)}
          />
          <h2>Animation</h2>
          <Segmented
            label="Animation"
            options={animationPrefs}
            value={feel.animation}
            onChange={(v) => change("animation", v)}
          />
          <label className="gd-check">
            <input
              type="checkbox"
              checked={feel.sound}
              onChange={(e) => {
                change("sound", e.target.checked ? "on" : "");
                if (e.target.checked)
                  feedback("success", { ...settings, sound: true });
              }}
            />
            Sound
          </label>
          <label className="gd-check">
            <input
              type="checkbox"
              checked={feel.haptics}
              disabled={!feel.hapticsSupported}
              onChange={(e) => change("haptics", e.target.checked ? "on" : "")}
            />
            Haptics
            {!feel.hapticsSupported && (
              <small> Not supported on this device</small>
            )}
          </label>
        </div>
      )}
    </div>
  );
}

// The always-visible bar: wordmark, six sections, search, week and source freshness, hypothetical chip, import, sync and Feel.
export function GamedayHeader({
  route,
  model,
  sourceUTC,
  week,
  finalWeek,
  syncStatus,
  hypothetical,
  busy,
  onImport,
  feel,
  changeFeel,
}: {
  route: string;
  model: Model | null;
  sourceUTC: string | null | undefined;
  week: number | null;
  finalWeek: number | null;
  syncStatus: string;
  hypothetical: string | null;
  busy: boolean;
  onImport: () => void;
  feel: FeelValues;
  changeFeel: (
    key: "theme" | "animation" | "sound" | "haptics",
    value: string,
  ) => void;
}) {
  const current = sectionForRoute(route),
    fresh = sourceFreshness(sourceUTC, Date.now());
  return (
    <header className="gd-header">
      <a className="gd-wordmark" href="#/overview">
        FFL GAMEDAY
      </a>
      <nav aria-label="Main navigation" className="gd-nav">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#/${s.id}`}
            aria-current={current === s.id ? "page" : undefined}
          >
            {s.label}
          </a>
        ))}
      </nav>
      <PlayerSearch model={model} />
      <span
        className={`gd-fresh${sourceUTC !== undefined && fresh.stale ? " stale" : ""}`}
      >
        {week !== null &&
          `W${week}${finalWeek !== null ? `/${finalWeek}` : ""} · `}
        {sourceUTC === undefined ? "No data imported" : fresh.label}
      </span>
      {hypothetical && (
        <a className="gd-chip" href="#/overview">
          Hypothetical: {hypothetical}
        </a>
      )}
      <a
        className="gd-pill"
        href="#/data"
        aria-label={`Sync status: ${syncStatus}`}
      >
        {syncStatus}
      </a>
      <button
        type="button"
        className="gd-pill"
        onClick={onImport}
        disabled={busy}
      >
        {busy ? "Reading…" : "Import"}
      </button>
      <KeyboardReferenceButton />
      <FeelMenu feel={feel} change={changeFeel} />
    </header>
  );
}
