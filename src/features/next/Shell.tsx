import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  bottomBarItems,
  searchPlayers,
  sectionForRoute,
  sections,
  sourceFreshness,
  syncPillLabel,
} from "../../domain/view/shell";
import type { Model } from "../../domain/valuation";
import { useKeyboardReference } from "./KeyboardReference";
import { SimulationIssuePopover } from "./SimulationIssuePopover";
import { usePopovers } from "../../ui/popover/PopoverStack";
import { useOpenPlayer } from "./PlayerCard";
import { Segmented } from "../../ui/primitives";
import {
  animationPrefs,
  feedback,
  type AnimationPref,
} from "../../ui/feel/settings";
import {
  themePrefs,
  useResolvedTheme,
  type ThemePref,
} from "../../ui/feel/theme";
import { Moon, Sun } from "lucide-react";

export interface FeelValues {
  theme: ThemePref;
  animation: AnimationPref;
  sound: boolean;
  haptics: boolean;
  cardEntrances?: boolean;
  // Haptics report "not supported" where the Vibration API is missing.
  hapticsSupported: boolean;
}

// Search any player by name; results come from the domain search and open the player's evaluation.
function PlayerSearch({ model }: { model: Model | null }) {
  const openPlayer = useOpenPlayer();
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
    openPlayer(hit.id);
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

// The four independent Feel settings, shared by the header menu and the Lab page.
export function FeelSettings({
  feel,
  change,
}: {
  feel: FeelValues;
  change: (
    key: "theme" | "animation" | "sound" | "haptics" | "cardEntrances",
    value: string,
  ) => void;
}) {
  const settings = { sound: feel.sound, haptics: feel.haptics };
  return (
    <>
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
        {!feel.hapticsSupported && <small> Not supported on this device</small>}
      </label>
      <label className="gd-check">
        <input
          type="checkbox"
          checked={feel.cardEntrances !== false}
          onChange={(e) => change("cardEntrances", e.target.checked ? "" : "off")}
        />
        Player card entrances
      </label>
    </>
  );
}

// The one-tap theme switch beside the menu: it names the theme it moves to, so light and dark are one tap apart.
function ThemeToggle({
  feel,
  change,
}: {
  feel: FeelValues;
  change: (key: "theme", value: string) => void;
}) {
  const resolved = useResolvedTheme(feel.theme),
    next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="gd-pill gd-theme-toggle"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      onClick={() => change("theme", next)}
    >
      {resolved === "dark" ? (
        <Sun size={16} aria-hidden />
      ) : (
        <Moon size={16} aria-hidden />
      )}
      <span className="gd-wide-only">
        {next === "dark" ? "Dark" : "Light"}
      </span>
    </button>
  );
}

// One menu holds the four Feel settings and the keyboard reference, so the header keeps to a single row.
function FeelMenu({
  feel,
  change,
}: {
  feel: FeelValues;
  change: (
    key: "theme" | "animation" | "sound" | "haptics" | "cardEntrances",
    value: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    openReference = useKeyboardReference();
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className="gd-feel" ref={ref}>
      <button
        ref={button}
        type="button"
        className="gd-pill"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Feel
      </button>
      {open && (
        <div className="gd-menu" role="group" aria-label="Feel settings">
          <FeelSettings feel={feel} change={change} />
          <button
            type="button"
            className="gd-menu-link"
            onClick={() => {
              // The menu closes, so focus returns to its button when the reference is closed.
              setOpen(false);
              button.current?.focus({ preventScroll: true });
              openReference();
            }}
          >
            Keyboard reference
          </button>
        </div>
      )}
    </div>
  );
}

// The narrow-width menu: import, sync, the Lab, the journal, the keyboard reference and the Feel settings in one place.
function MoreMenu({
  syncStatus,
  busy,
  onImport,
  feel,
  changeFeel,
}: {
  syncStatus: string;
  busy: boolean;
  onImport: () => void;
  feel: FeelValues;
  changeFeel: (
    key: "theme" | "animation" | "sound" | "haptics" | "cardEntrances",
    value: string,
  ) => void;
}) {
  const [open, setOpen] = useState(false),
    openReference = useKeyboardReference();
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className="gd-feel gd-narrow-only">
      <button
        type="button"
        className="gd-pill"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Menu
      </button>
      {open && (
        <div
          className="gd-menu gd-more"
          role="group"
          aria-label="Menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <button
            type="button"
            className="gd-pill"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onImport();
            }}
          >
            {busy ? "Reading…" : "Import workbook"}
          </button>
          <a href="#/lab/data">Sync status: {syncStatus}</a>
          <a href="#/lab">Lab</a>
          <a href="#/journal">Trade journal</a>
          <FeelSettings feel={feel} change={changeFeel} />
          <button
            type="button"
            className="gd-menu-link"
            onClick={() => {
              setOpen(false);
              openReference();
            }}
          >
            Keyboard reference
          </button>
        </div>
      )}
    </div>
  );
}

// The phone bottom bar: the five main sections, shown only below 720px.
export function BottomBar({ route }: { route: string }) {
  const current = sectionForRoute(route);
  return (
    <nav aria-label="Phone navigation" className="gd-bottombar">
      {bottomBarItems.map((s) => (
        <a
          key={s.id}
          href={`#/${s.id}`}
          aria-current={current === s.id ? "page" : undefined}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

// The always-visible bar: wordmark, six sections, search, week and source freshness, simulation chip, import, sync and Feel.
export function GamedayHeader({
  route,
  model,
  sourceUTC,
  week,
  finalWeek,
  syncStatus,
  hypothetical,
  simulation,
  busy,
  onImport,
  feel,
  changeFeel,
  onApplyDrop,
  onSwitchToLive,
}: {
  route: string;
  model: Model | null;
  sourceUTC: string | null | undefined;
  week: number | null;
  finalWeek: number | null;
  syncStatus: string;
  hypothetical?: string | null;
  simulation?: Model["simulation"] | null;
  busy: boolean;
  onImport: () => void;
  feel: FeelValues;
  changeFeel: (
    key: "theme" | "animation" | "sound" | "haptics" | "cardEntrances",
    value: string,
  ) => void;
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
}) {
  const current = sectionForRoute(route),
    fresh = sourceFreshness(sourceUTC, Date.now());
  const popovers = usePopovers();
  const simName = simulation?.scenario.name ?? hypothetical;
  const hasIssues = Boolean(
    simulation?.structuredIssues && simulation.structuredIssues.length > 0,
  );
  const openSimPopover = () => {
    if (!simulation) return;
    popovers.open({
      title: `Simulation: ${simulation.scenario.name}`,
      width: 480,
      render: (close) => (
        <SimulationIssuePopover
          simulation={simulation}
          onApplyDrop={onApplyDrop}
          onSwitchToLive={onSwitchToLive}
          close={close}
        />
      ),
    });
  };
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
        title={sourceUTC === undefined ? "No data imported" : fresh.label}
      >
        {week !== null &&
          `W${week}${finalWeek !== null ? `/${finalWeek}` : ""} · `}
        {sourceUTC === undefined ? (
          "No data imported"
        ) : (
          <>
            <span className="gd-wide-only">{fresh.label}</span>
            <span className="gd-narrow-only">{fresh.short}</span>
          </>
        )}
      </span>
      {simName && (
        simulation ? (
          <button
            type="button"
            className={`gd-chip${hasIssues ? " gd-chip-warning" : ""}`}
            onClick={openSimPopover}
            title={
              hasIssues
                ? `${simulation.structuredIssues?.length} unresolved roster limit(s)`
                : `Simulation: ${simName}`
            }
          >
            Simulation: {simName}
          </button>
        ) : (
          <a className="gd-chip" href="#/overview">
            Simulation: {simName}
          </a>
        )
      )}
      <a
        className="gd-pill gd-wide-only gd-sync"
        href="#/lab/data"
        aria-label={`Sync status: ${syncStatus}`}
        title={`Sync status: ${syncStatus}`}
      >
        {syncPillLabel(syncStatus)}
      </a>
      <button
        type="button"
        className="gd-pill gd-wide-only"
        onClick={onImport}
        disabled={busy}
      >
        {busy ? "Reading…" : "Import"}
      </button>
      <ThemeToggle feel={feel} change={changeFeel} />
      <span className="gd-wide-only">
        <FeelMenu feel={feel} change={changeFeel} />
      </span>
      <MoreMenu
        syncStatus={syncStatus}
        busy={busy}
        onImport={onImport}
        feel={feel}
        changeFeel={changeFeel}
      />
    </header>
  );
}
