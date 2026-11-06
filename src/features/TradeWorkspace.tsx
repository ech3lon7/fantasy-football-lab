import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronLeft,
  Shield,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import type { Draft } from "../domain/contracts";
import { str } from "../domain/contracts";
import type { Model, Player } from "../domain/valuation";
import type { TradeSearchQuery } from "../domain/trade-search";
import type { LineupBasis } from "../domain/trade-impact";
import { tradeImpact } from "../domain/trade-impact";
import type { ChainPositionImpact } from "../domain/chain-position-impact";
import { scenarioLineupBoard } from "../domain/roster-scenarios";
import { fmt, signed } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";
import field from "../assets/trade-field.webp";

// A result preview carries its captured model/lineup context and never mutates search criteria or roster ownership.
export interface TradeWorkspacePreview {
  key: string;
  draft: Draft;
  model: Model;
  basis: LineupBasis;
  plans?: string;
  label: string;
  query?: TradeSearchQuery;
  prerequisite?: boolean;
}
// Chain configuration is presented separately from the editable single-trade draft.
export interface TradeChainPool {
  team: string;
  pool: string[];
  basis: LineupBasis;
}
export type TradeWorkspaceMode = "standard" | "chain" | null;
// Field cards and pool cards share the same team-scoped payload and existing drop validation.
export const tradePlayerDrag = "application/x-fantasy-trade-player";
export const tradeTeamName = (m: Model, id: string) =>
  str(
    m.dataset.tables.ModelTeams.find((team) => str(team.TeamID) === id)
      ?.TeamName,
  ) || id;

// Reuse the app's public ESPN portrait source and icon fallback; portrait failures never hide the player's name or stats.
export function TradePortrait({ player }: { player: Player }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="trade-portrait" aria-hidden="true">
      {Number(player.id) > 0 && !failed ? (
        <img
          loading="lazy"
          alt=""
          src={`https://a.espncdn.com/i/headshots/nfl/players/full/${player.id}.png`}
          onError={() => setFailed(true)}
        />
      ) : player.pos === "D/ST" ? (
        <Shield size={24} />
      ) : (
        <UserRound size={24} />
      )}
    </span>
  );
}

// Each tool owns a nonmodal push drawer: controls stay mounted and usable without covering the offer builder or results.
export function TradeFiltersButton({
  scope,
  open,
  toggle,
}: {
  scope: string;
  open: boolean;
  toggle: () => void;
}) {
  return (
    <button
      type="button"
      className="button trade-filters-toggle"
      aria-label={`${scope} filters`}
      aria-expanded={open}
      aria-controls={`${scope.toLowerCase()}-trade-filters`}
      onClick={toggle}
    >
      <SlidersHorizontal size={16} aria-hidden="true" /> Filters
    </button>
  );
}
export function TradeFiltersDrawer({
  scope,
  open,
  close,
  children,
}: {
  scope: string;
  open: boolean;
  close: () => void;
  children: ReactNode;
}) {
  const title = useId();
  function dismiss() {
    close();
    document
      .querySelector<HTMLButtonElement>(
        `button[aria-controls="${scope.toLowerCase()}-trade-filters"]`,
      )
      ?.focus();
  }
  return (
    <aside
      id={`${scope.toLowerCase()}-trade-filters`}
      className="trade-filters-drawer"
      aria-labelledby={title}
      aria-hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          dismiss();
        }
      }}
    >
      <div className="trade-filters-drawer-inner">
        <div className="trade-drawer-heading">
          <h3 id={title}>{scope} filters</h3>
          <button
            className="subtle"
            type="button"
            aria-label={`Close ${scope.toLowerCase()} filters`}
            onClick={dismiss}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
        {children}
      </div>
    </aside>
  );
}

// Display the authoritative selected-basis before/after averages; no presentation component recomputes trade gains.
export function TradeScoreStrip({
  m,
  draft,
  impact,
  pending,
  label,
  dealGrade,
  dealTone,
}: {
  m: Model;
  draft: Draft;
  impact: ReturnType<typeof tradeImpact>;
  pending: boolean;
  label?: string;
  // Optional surplus deal grade ("Fair deal", "Steal deal", etc.) and visual color tone
  dealGrade?: string;
  dealTone?: "good" | "bad" | "orange" | "neutral";
}) {
  // An incomplete offer has no trade forecast; one compact hint preserves room for player cards and the field.
  if (!draft.give.length || !draft.get.length)
    return (
      <section className="trade-score-empty" aria-label="Trade scoring summary">
        Choose players on both sides to compare weekly lineup impact.
      </section>
    );
  return (
    <section
      className="trade-score-strip"
      aria-label="Trade scoring summary"
      aria-busy={pending}
    >
      {(
        [
          ["Your", draft.teamA, impact?.own],
          ["Their", draft.teamB, impact?.other],
        ] as const
      ).map(([side, id, values]) => (
        <div className="trade-score-team" key={side}>
          <div>
            <strong>{tradeTeamName(m, id)}</strong>
            <small>{side} average Expected PPG</small>
          </div>
          <div className="trade-score-values model">
            <span>{pending ? "…" : fmt(values?.beforePerWeek ?? null)}</span>
            <ArrowRight size={17} aria-hidden="true" />
            <strong>{pending ? "…" : fmt(values?.afterPerWeek ?? null)}</strong>
            <b>{pending ? "…" : signed(values?.expectedPerWeek ?? null)}</b>
          </div>
        </div>
      ))}
      {/* Context row displaying calculation bounds alongside a concise, non-invasive surplus deal grade badge */}
      <div className="trade-score-context-row">
        <small className="trade-score-context">
          {label ? `${label} · ` : ""}Average across Weeks {m.current}–{m.final};
          model scoring, not ESPN's weekly projection.
        </small>
        {dealGrade && (
          <span
            className={`trade-deal-pill ${dealTone ?? "neutral"}`}
            role="status"
            aria-label={`Surplus deal grade: ${dealGrade}`}
          >
            Surplus: <strong>{dealGrade}</strong>
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * Renders colored positional grade chips for each affected position.
 * Displays before and after grades with .good, .bad, or .neutral tone classes.
 */
export function PositionGradeChips({
  impact,
  side,
}: {
  impact?: ChainPositionImpact;
  side?: "own" | "other";
}) {
  if (!impact) return null;
  // If side is specified, only show that side's changes; otherwise show own then other
  const ownList = side === "other" ? [] : (impact.own ?? []);
  const otherList = side === "own" ? [] : (impact.other ?? []);
  const all = [
    ...ownList.map((r) => ({ ...r, suffix: "" })),
    ...otherList.map((r) => ({ ...r, suffix: side ? "" : " (them)" })),
  ];
  if (all.length === 0) return null;

  return (
    <div className="trade-position-chips" aria-label="Positional grade changes">
      {all.map((row) => {
        const tone =
          row.drop === null || row.before === row.after
            ? "neutral"
            : row.drop > 0
              ? "bad"
              : "good";
        return (
          <span
            key={`${row.position}-${row.before}-${row.after}-${row.suffix}`}
            className={`position-grade-chip ${tone}`}
            title={
              row.drop && row.drop > 0
                ? `${row.position} drops ${row.drop} step${row.drop > 1 ? "s" : ""}`
                : row.before !== row.after
                  ? `${row.position} upgraded`
                  : `${row.position} unchanged`
            }
          >
            <span className="pos-label">
              {row.position}
              {row.suffix}
            </span>
            <span className="pos-grades">
              {row.before} → {row.after}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// The field reads exact beforeIds/ids from the evaluator's weekly result; the week control distinguishes one lineup from headline season averages.
export function TradeLineupField({
  m,
  draft,
  impact,
  basis,
  plans,
  pending,
  poolScope,
  positionImpact,
}: {
  m: Model;
  draft: Draft;
  impact: ReturnType<typeof tradeImpact>;
  basis: LineupBasis;
  plans?: string;
  pending: boolean;
  poolScope?: string;
  // Positional grade changes before and after trade for each team
  positionImpact?: ChainPositionImpact;
}) {
  const [side, setSide] = useState<"own" | "other">("own"),
    [stage, setStage] = useState<"before" | "after">("after"),
    [selectedWeek, setWeek] = useState(m.current);
  const week = m.weeks.includes(selectedWeek) ? selectedWeek : m.current;
  const team = side === "own" ? draft.teamA : draft.teamB;
  const base = useMemo(
    () =>
      scenarioLineupBoard(
        m,
        team,
        week,
        basis === "marked-starters" ? "marked" : "optimized",
        plans,
      ),
    [m, team, week, basis, plans],
  );
  const weekly = impact?.[side].weekly.find((row) => row.week === week);
  const slots = weekly?.slots ?? base.roles.map((role) => role.slot);
  const before = weekly?.beforeIds ?? base.roles.map((role) => role.id);
  const after = weekly?.ids ?? before;
  const ids = stage === "after" ? after : before;
  // Retrieve positional grade transitions for the currently selected team side
  const posChanges = positionImpact?.[side] ?? [];
  // Reset only the chosen week when a replacement snapshot no longer contains it; team/stage preferences remain local view state.
  useEffect(() => {
    if (!m.weeks.includes(selectedWeek)) setWeek(m.current);
  }, [m.current, m.weeks.join(",")]);
  return (
    <section
      className="trade-lineup-panel"
      aria-label="Visual lineup impact"
      aria-busy={pending}
    >
      <div className="trade-field-heading">
        <h3>Lineup impact</h3>
        <div className="trade-view-switch" aria-label="Lineup team">
          <button
            type="button"
            aria-pressed={side === "own"}
            onClick={() => setSide("own")}
          >
            Your team
          </button>
          <button
            type="button"
            aria-pressed={side === "other"}
            onClick={() => setSide("other")}
          >
            Their team
          </button>
        </div>
      </div>
      {/* Positional grade changes: displays before-and-after letter grades colored by upgrade/downgrade */}
      {posChanges.length > 0 && (
        <div
          className="trade-position-grades"
          aria-label={`${side === "own" ? "Your" : "Their"} positional grade changes`}
        >
          <span className="trade-position-grades-label">Grades:</span>
          <PositionGradeChips impact={positionImpact} side={side} />
        </div>
      )}
      <div className="trade-field-controls">
        <span>{tradeTeamName(m, team)}</span>
        <label>
          Week{" "}
          <select
            aria-label="Trade board week"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {m.weeks.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <div className="trade-view-switch" aria-label="Lineup stage">
          <button
            type="button"
            aria-pressed={stage === "before"}
            onClick={() => setStage("before")}
          >
            Before
          </button>
          <button
            type="button"
            aria-pressed={stage === "after"}
            onClick={() => setStage("after")}
          >
            After
          </button>
        </div>
      </div>
      {pending ? (
        <p className="notice" role="status">
          Updating lineup preview…
        </p>
      ) : (
        <div
          className="trade-field"
          style={{ backgroundImage: `url(${field})` }}
        >
          {slots.map((slot, index) => {
            const id = ids[index],
              player = id ? m.byId.get(id) : undefined;
            // Only owned players in an editable finder can be offered; incoming players and result previews stay read-only.
            const canDrag =
              !!poolScope && side === "own" && player?.owner === team;
            const previous = before[index]
              ? m.byId.get(before[index]!)
              : undefined;
            const changed = !!weekly && before[index] !== after[index];
            // Classify the departing occupant, not the incoming player's origin; both teams follow the same rule.
            const tradedAway =
              changed &&
              !!previous &&
              (side === "own" ? draft.give : draft.get).includes(previous.id);
            // A player already in this team's before-lineup is shifting starter slots, not being promoted from the bench.
            // The red departure marker keeps priority when the former slot occupant is traded away.
            const starterShift =
              changed &&
              !tradedAway &&
              !!after[index] &&
              before.includes(after[index]);
            const changeKind = tradedAway
              ? "trade"
              : starterShift
                ? "starter-shift"
                : "lineup";
            return (
              <article
                className={`trade-field-player${changed ? ` is-changed is-${changeKind}-change` : ""}`}
                data-change-kind={changed ? changeKind : undefined}
                draggable={canDrag}
                onDragStart={(event) => {
                  // Cancel native image/link drags on read-only cards instead of accepting them as player selections.
                  if (!canDrag || !player) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(
                    tradePlayerDrag,
                    JSON.stringify({ scope: poolScope, team, id: player.id }),
                  );
                }}
                key={`${slot}-${index}`}
                aria-label={`${slot}: ${player?.name ?? "Unfilled"}${changed ? ", changed" : ""}`}
              >
                <small>{slot}</small>
                {player ? (
                  <>
                    <TradePortrait key={player.id} player={player} />
                    <PlayerName p={player} />
                    <strong className="model">{fmt(player.expected)}</strong>
                  </>
                ) : (
                  <>
                    <UserRound size={24} aria-hidden="true" />
                    <span>Unfilled</span>
                  </>
                )}
                {changed && stage === "after" && (
                  <small className="trade-field-replacement">
                    {previous
                      ? `Replaces ${previous.name}`
                      : "Fills empty slot"}
                  </small>
                )}
              </article>
            );
          })}
        </div>
      )}
      <small className="trade-field-footnote">
        Week {week} lineup ·{" "}
        {stage === "after" && weekly
          ? "Changed slots highlighted"
          : "Before-trade starters"}
        .{" "}
        {weekly && (
          <>
            Red: traded-away player replaced. Yellow: starter-to-starter shift.
            Blue: other lineup adjustment.{" "}
          </>
        )}
        Player values are model Expected PPG; the top strip averages all
        remaining weeks.
      </small>
      {!weekly && !pending && (
        <small className="muted">
          {draft.give.length && draft.get.length
            ? "No usable weekly trade result. Review the full analysis for missing data or invalid inputs."
            : "Choose players on both sides to preview the trade."}
        </small>
      )}
    </section>
  );
}
