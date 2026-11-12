import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronLeft,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import type { Draft } from "../domain/contracts";
import { str } from "../domain/contracts";
import type { Model, Player } from "../domain/valuation";
import type { TradeSearchQuery } from "../domain/trade-search";
import type { LineupBasis } from "../domain/trade-impact";
import { tradeImpact } from "../domain/trade-impact";
import { type ChainPositionImpact, type ChainPositionChange, netGradeStepDelta } from "../domain/chain-position-impact";
import { scenarioLineupBoard } from "../domain/roster-scenarios";
import { fmt, signed } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";
import { PlayerPhoto } from "../ui/PlayerPhoto";
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

// Reuse PlayerPhoto with team colours and initials fallback; portrait failures never hide player name or stats.
export function TradePortrait({ player }: { player: Player }) {
  return <PlayerPhoto player={player} size={28} className="trade-portrait" />;
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
 * When side is specified, displays chips for that side.
 * When side is omitted, organizes changes into clearly separated "Your team" and
 * opponent team sections with overall net step count badges and horizontal chip flows.
 */
export function PositionGradeChips({
  impact,
  side,
  teamBName,
  onlyImpacts = false,
}: {
  impact?: ChainPositionImpact;
  side?: "own" | "other";
  teamBName?: string;
  onlyImpacts?: boolean;
}) {
  if (!impact) return null;
  const ownList = side === "other" ? [] : (impact.own ?? []);
  const otherList = side === "own" ? [] : (impact.other ?? []);

  const renderChip = (row: ChainPositionChange, suffix = "") => {
    const tone =
      row.drop === null || row.before === row.after
        ? "neutral"
        : row.drop > 0
          ? "bad"
          : "good";
    return (
      <span
        key={`${row.position}-${row.before}-${row.after}-${suffix}`}
        className={`position-grade-chip ${tone}`}
        title={
          row.drop != null && row.drop > 0
            ? `${row.position} drops ${row.drop} step${row.drop > 1 ? "s" : ""}`
            : row.before !== row.after
              ? `${row.position} upgraded`
              : `${row.position} unchanged`
        }
      >
        <span className="pos-label">
          {row.position}
          {suffix}
        </span>
        <span className="pos-grades">
          {row.before} → {row.after}
        </span>
        {row.stepDelta !== null && row.stepDelta !== undefined && (
          <span className="pos-step-delta">
            {row.stepDelta > 0 ? `+${row.stepDelta} steps` : `${row.stepDelta} steps`}
          </span>
        )}
      </span>
    );
  };

  // If a single side is requested (e.g. Lineup Impact screen tab), render inline list
  if (side) {
    const rawList = side === "own" ? ownList : otherList;
    const list = onlyImpacts
      ? rawList.filter((row) => row.stepDelta !== null && row.stepDelta !== 0)
      : rawList;
    if (list.length === 0) {
      return (
        <span className="trade-position-none" aria-label="No positional grade changes">
          No grade changes
        </span>
      );
    }
    return (
      <div className="trade-position-chips" aria-label={`${side === "own" ? "Your" : "Their"} positional grade changes`}>
        {list.map((row) => renderChip(row))}
      </div>
    );
  }

  // When both sides are displayed (e.g. candidate trade cards), organize into distinct side-by-side groups
  if (ownList.length === 0 && otherList.length === 0) return null;
  const ownNet = netGradeStepDelta(ownList);
  const otherNet = netGradeStepDelta(otherList);
  const ownTone = ownNet > 0 ? "good" : ownNet < 0 ? "bad" : "neutral";
  const otherTone = otherNet > 0 ? "good" : otherNet < 0 ? "bad" : "neutral";

  const ownDisplay = onlyImpacts
    ? ownList.filter((row) => row.stepDelta !== null && row.stepDelta !== 0)
    : ownList;
  const otherDisplay = onlyImpacts
    ? otherList.filter((row) => row.stepDelta !== null && row.stepDelta !== 0)
    : otherList;

  return (
    <div className="trade-position-grades-split" aria-label="Positional grade changes">
      {ownList.length > 0 && (
        <div className="trade-position-side-group own">
          <div className="trade-position-side-header">
            <span className="side-title">Your team:</span>
            <span
              className={`trade-position-net-step ${ownTone}`}
              aria-label={`Your overall net grade step change: ${ownNet > 0 ? `+${ownNet}` : ownNet} steps`}
            >
              {ownNet > 0 ? `+${ownNet}` : `${ownNet}`} overall steps
            </span>
          </div>
          <div className="trade-position-chips">
            {ownDisplay.length > 0 ? (
              ownDisplay.map((row) => renderChip(row))
            ) : (
              <span className="trade-position-none">No grade changes</span>
            )}
          </div>
        </div>
      )}

      {otherList.length > 0 && (
        <div className="trade-position-side-group other">
          <div className="trade-position-side-header">
            <span className="side-title">{teamBName ? `${teamBName}:` : "Their team:"}</span>
            <span
              className={`trade-position-net-step ${otherTone}`}
              aria-label={`${teamBName ?? "Their"} overall net grade step change: ${otherNet > 0 ? `+${otherNet}` : otherNet} steps`}
            >
              {otherNet > 0 ? `+${otherNet}` : `${otherNet}`} overall steps
            </span>
          </div>
          <div className="trade-position-chips">
            {otherDisplay.length > 0 ? (
              otherDisplay.map((row) => renderChip(row, " (them)"))
            ) : (
              <span className="trade-position-none">No grade changes</span>
            )}
          </div>
        </div>
      )}
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
          <div className="trade-position-grades-content">
            <span className="trade-position-grades-label">Grades:</span>
            <PositionGradeChips impact={positionImpact} side={side} onlyImpacts />
          </div>
          {(() => {
            const net = netGradeStepDelta(posChanges);
            const netClass = net > 0 ? "good" : net < 0 ? "bad" : "neutral";
            return (
              <span
                className={`trade-position-net-step ${netClass}`}
                aria-label={`${side === "own" ? "Your" : "Their"} overall net grade step change`}
              >
                {net > 0 ? `+${net}` : `${net}`} overall steps
              </span>
            );
          })()}
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
