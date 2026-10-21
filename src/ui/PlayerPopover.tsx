import { GemEvidence } from "./GemEvidence";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { str, num } from "../domain/contracts";
import type { Model, Player } from "../domain/valuation";
import { marketStatus, playedHistory } from "../domain/opportunity";
import {
  extendedColumns,
  fmt,
  pct,
  PlayerSignals,
  Signal,
  Trend,
} from "./components";
import { PlayerPopoverContext } from "./PlayerName";

// A portal keeps the inspection panel outside scrolling tables and the mobile inert app shell.
export function PlayerPopoverProvider({
  m,
  children,
}: {
  m: Model | null;
  children: ReactNode;
}) {
  const [selection, setSelection] = useState<{
    id: string;
    anchor: HTMLElement;
    trigger: string;
  } | null>(null);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 780px)").matches,
  );
  const [position, setPosition] = useState<CSSProperties>({
    visibility: "hidden",
  });
  const panel = useRef<HTMLDivElement>(null);
  const player = selection ? m?.byId.get(selection.id) : null;
  const close = useCallback((restore = true) => {
    setSelection((previous) => {
      if (restore && previous)
        requestAnimationFrame(() => {
          if (previous.anchor.isConnected)
            previous.anchor.focus({ preventScroll: true });
        });
      return null;
    });
  }, []);
  const open = useCallback(
    (id: string, anchor: HTMLElement, trigger: string) => {
      setPosition({ visibility: "hidden" });
      setSelection((previous) =>
        previous?.trigger === trigger ? null : { id, anchor, trigger },
      );
    },
    [],
  );
  const context = useMemo(
    () => ({ activeTrigger: selection?.trigger ?? null, open }),
    [selection, open],
  );

  // Layout changes switch between an anchored desktop card and a mobile bottom sheet.
  useEffect(() => {
    const query = matchMedia("(max-width: 780px)"),
      update = () => setMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  // Never retain another route or imported snapshot's inspection state.
  useEffect(() => {
    close(false);
  }, [m?.dataset.hash, close]);
  useEffect(() => {
    const dismiss = () => close(false);
    window.addEventListener("hashchange", dismiss);
    return () => window.removeEventListener("hashchange", dismiss);
  }, [close]);

  // Reposition after scrolling, resizing or expanding details without clipping the viewport.
  useLayoutEffect(() => {
    if (!selection || !player || !panel.current) return;
    const element = panel.current;
    function place() {
      if (!selection!.anchor.isConnected) {
        close(false);
        return;
      }
      if (mobile) {
        setPosition({});
        return;
      }
      const rect = selection!.anchor.getBoundingClientRect(),
        margin = 12,
        gap = 8;
      // An anchor scrolled out of view should not leave an orphaned card on the screen.
      if (
        rect.bottom < 0 ||
        rect.top > innerHeight ||
        rect.right < 0 ||
        rect.left > innerWidth
      ) {
        close(false);
        return;
      }
      const width = Math.min(460, innerWidth - margin * 2);
      const below = innerHeight - rect.bottom - gap - margin,
        above = rect.top - gap - margin;
      const down =
        below >= Math.min(400, element.scrollHeight) || below >= above;
      const room = Math.min(680, down ? below : above);
      const maxHeight = room < 200 ? innerHeight - margin * 2 : room;
      const height = Math.min(element.scrollHeight, maxHeight);
      setPosition({
        width,
        maxHeight,
        left: Math.max(
          margin,
          Math.min(rect.left, innerWidth - width - margin),
        ),
        top:
          room < 200
            ? margin
            : down
              ? rect.bottom + gap
              : rect.top - gap - height,
      });
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    element.addEventListener("toggle", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      element.removeEventListener("toggle", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [selection, player, mobile, close]);

  // Dismiss on Escape or an outside interaction; mobile confines keyboard focus to the sheet.
  useEffect(() => {
    if (!selection || !player || !panel.current) return;
    const element = panel.current,
      shell = document.querySelector<HTMLElement>(".app-shell");
    const overflow = document.body.style.overflow,
      wasInert = shell?.inert ?? false;
    if (mobile) {
      document.body.style.overflow = "hidden";
      if (shell) shell.inert = true;
    }
    element
      .querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
    const inside = (target: EventTarget | null) =>
      target instanceof Node &&
      (element.contains(target) || selection.anchor.contains(target));
    const outside = (event: PointerEvent) => {
      if (!inside(event.target)) close(mobile);
    };
    const focus = (event: FocusEvent) => {
      if (!mobile && !inside(event.target)) close(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (!mobile || event.key !== "Tab") return;
      const controls = [
        ...element.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), summary, [tabindex="0"]',
        ),
      ].filter((node) => node.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("keydown", keyboard);
      if (mobile) {
        document.body.style.overflow = overflow;
        if (shell) shell.inert = wasInert;
      }
    };
  }, [selection, player, mobile, close]);

  return (
    <PlayerPopoverContext.Provider value={context}>
      {children}
      {selection &&
        player &&
        m &&
        createPortal(
          <>
            {mobile && (
              <div className="player-popover-backdrop" aria-hidden="true" />
            )}
            <div
              id="player-popover"
              ref={panel}
              className="player-popover"
              role="dialog"
              aria-modal={mobile || undefined}
              aria-labelledby="player-popover-title"
              data-layout={mobile ? "sheet" : "popover"}
              style={position}
              tabIndex={-1}
            >
              <div className="player-popover-heading">
                <div>
                  <h2 id="player-popover-title">{player.name}</h2>
                  <span className="fact">
                    {player.pos} · {player.nfl}
                  </span>
                </div>
                <button
                  className="subtle"
                  aria-label="Close player details"
                  onClick={() => close()}
                >
                  <X size={20} />
                </button>
              </div>
              <PlayerInspection key={player.id} p={player} m={m} />
              <a
                className="button"
                href={`#/player/${player.id}`}
                onClick={() => close(false)}
              >
                Open full player page
              </a>
            </div>
          </>,
          document.body,
        )}
    </PlayerPopoverContext.Provider>
  );
}

// Reuse the same model fields and evaluation columns as the full profile; never recalculate player value here.
function PlayerInspection({ p, m }: { p: Player; m: Model }) {
  const owner =
    p.owner === "0"
      ? "Available / waivers"
      : str(
          m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === p.owner)
            ?.TeamName,
        ) || "Unknown team";
  const scores = playedHistory(m.dataset).get(p.id) ?? [];
  const stale =
    !m.dataset.sourceUTC ||
    Date.now() - Date.parse(m.dataset.sourceUTC) > 86400000;
  const metrics: [string, number | null, string][] = [
    ["Actual season PPG", p.actual, "fact"],
    ["Recent PPG (last 3)", p.recent, "fact"],
    ["ESPN season PPG", p.projected, "projection"],
    [`ESPN Week ${m.current}`, p.weekly, "projection"],
    ["Expected PPG", p.expected, "model"],
    ["Value PPG", p.value, "model"],
    ["Surplus index", p.index, "model"],
    ["Games played", p.games, "fact"],
  ];
  const advanced: [string, number | null, string, boolean?][] = [
    ["Recent opportunities / game", p.opportunity.recentRate, "fact"],
    ["Earlier opportunities / game", p.opportunity.priorRate, "fact"],
    ["Recent snap share", p.opportunity.snapShare, "fact", true],
    ["Recent route participation", p.opportunity.routes, "fact", true],
    ["Carries inside 5 / game", p.opportunity.rushInside5, "fact"],
    ["Red-zone targets / game", p.opportunity.redZoneTargets, "fact"],
    ["Original blended forecast PPG", p.blendedExpected, "model"],
    ["Scoring variability (sample SD)", p.scoringSD, "fact"],
  ];
  return (
    <>
      <p className="fact player-popover-owner">
        {owner} · Player ID {p.id}
      </p>
      <p>
        <span className="fact">Injury: {p.injury}</span>
        {p.uncertain && <Signal text="CONDITIONAL availability" />}
      </p>
      {m.roleScenarioWeight > 0 && (
        <p className="notice warning">
          Experimental role forecast scenario:{" "}
          {Math.round(m.roleScenarioWeight * 100)}% role model.
        </p>
      )}
      <dl className="player-popover-metrics">
        {metrics.map(([label, value, kind]) => (
          <div key={label} className={value === null ? "muted" : kind}>
            <dt>{label}</dt>
            <dd>{fmt(value, label === "Games played" ? 0 : 2)}</dd>
          </div>
        ))}
      </dl>
      <div className="player-popover-signals">
        <Trend p={p} />
        <PlayerSignals p={p} />
        <Signal text={p.regression} />
      </div>
      <p>{p.explanation}</p>
      {/* Read-only automatic evidence matches the full player profile. */}
      <GemEvidence p={p} />
      <p
        className={
          p.historyComplete && p.value !== null ? "" : "notice warning"
        }
      >
        Model data: {p.status}. Replacement pool: {p.baselineStatus}.
      </p>
      {/* Expanded sections expose existing evaluation values, optional evidence and exact played-game scores. */}
      <details>
        <summary>All evaluation stats</summary>
        <dl className="definition-grid">
          {extendedColumns
            .filter((c) => !["name", "gem", "trend"].includes(c.key))
            .map((c) => (
              <div
                key={c.key}
                className={c.value(p) == null ? "muted" : c.kind}
              >
                <dt>{c.label}</dt>
                <dd>
                  {c.render
                    ? c.render(p)
                    : typeof c.value(p) === "number"
                      ? fmt(c.value(p))
                      : String(c.value(p) ?? "n.a.")}
                </dd>
              </div>
            ))}
        </dl>
      </details>
      <details>
        <summary>Workload and advanced evidence</summary>
        <p>{p.opportunity.source}</p>
        <dl className="definition-grid">
          {advanced.map(([label, value, kind, percent]) => (
            <div key={label} className={value === null ? "muted" : kind}>
              <dt>{label}</dt>
              <dd>{percent ? pct(value) : fmt(value)}</dd>
            </div>
          ))}
        </dl>
        <p>
          {p.opportunity.recentGames} recent games; {p.opportunity.priorGames}{" "}
          earlier games.
        </p>
        <p>{p.opportunity.supplementalStatus}</p>
        <p>{marketStatus(p.opportunity.market)}</p>
        {p.opportunity.market && (
          <p>
            {p.opportunity.market.Source} · {p.opportunity.market.AsOfUTC}
          </p>
        )}
        {p.uncertain && (
          <p>
            {p.opportunity.returnWeek === null
              ? "Return date unknown; availability remains conditional."
              : `User-selected return scenario: Week ${p.opportunity.returnWeek}.`}
          </p>
        )}
      </details>
      <details>
        <summary>Completed-game scores</summary>
        {scores.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Points</th>
                  <th>Carries</th>
                  <th>Targets</th>
                  <th>Catches</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((r) => (
                  <tr key={num(r.Week)} className="fact">
                    <td>{r.Week}</td>
                    <td>{fmt(r.Points)}</td>
                    {["RushAttempts", "Targets", "Receptions"].map((key) => (
                      <td
                        key={key}
                        className={r[key] == null ? "muted" : "fact"}
                      >
                        {fmt(r[key], 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No verified completed-game history available.</p>
        )}
      </details>
      <details>
        <summary>All imported player fields</summary>
        <dl className="definition-grid">
          {Object.entries(p.raw).map(([label, value]) => (
            <div
              key={label}
              className={
                value === null
                  ? "muted"
                  : /Project/.test(label)
                    ? "projection"
                    : "fact"
              }
            >
              <dt>{label}</dt>
              <dd>{value === null ? "n.a." : String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className={stale ? "notice warning" : "muted"}>
        {stale ? "Stale or undated snapshot. " : "Snapshot refreshed "}
        {m.dataset.sourceUTC
          ? new Date(m.dataset.sourceUTC).toLocaleString()
          : "Refresh time unavailable"}
        . Text color identifies data type. PPG is points per game; expected and
        value PPG are model estimates.
      </p>
    </>
  );
}
