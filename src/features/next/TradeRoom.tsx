import { useMemo, useState } from "react";
import { actionCue, searchCue, useFeedback } from "../../ui/feel/feedback";
import { str, type AppState, type Draft } from "../../domain/contracts";
import { evaluateTrade, type TradeResult } from "../../domain/trades";
import {
  lineupBasisLabel,
  lineupBases,
  readLineupBasis,
  tradeImpact,
  type LineupBasis,
} from "../../domain/trade-impact";
import { scenarioTradeErrors, type RosterScenario } from "../../domain/roster-scenarios";
import {
  gradeStepChips,
  lineupMoves,
  taleOfTape,
  verdicts,
  type GradeChip,
  type LineupSlot,
} from "../../domain/view/trade-room";
import type { Model, Player } from "../../domain/valuation";
import { PlayerName } from "../../ui/PlayerName";
import { PlayerPhoto } from "../../ui/PlayerPhoto";
import { teamColors } from "../../domain/view/nfl-colors";
import { Chip, Segmented } from "../../ui/primitives";
import { TradeStressTest } from "../TradeStressTest";
import { usePopovers } from "../../ui/popover/PopoverStack";
import { useNegotiations, DirectManagerAssessment } from "../Negotiations";
import { newJournalOffer } from "../../domain/trade-journal";
import { counterOffers, type CounterResults } from "../../domain/view/counter";
import { SimulationNote } from "./SimulationIssuePopover";
import { FoldingGroup, RangeSlider } from "../../ui/primitives";
import {
  defaultSearchLimits,
  editedLimits,
  readSearchLimits,
  searchLimitsKey,
  writeSearchLimits,
  type SearchLimits,
} from "../../domain/search-limits";
import {
  foldedGroupsKey,
  readOpenGroups,
  setGroupOpen,
} from "../../domain/view/primitives";
import {
  FoldMemoryContext,
  GradeGoalContext,
  SearchLimitsContext,
} from "./limitsContext";
import { gradeGoalSentence } from "../../domain/view/trade-room";
import { teamsAssessment } from "../../domain/lineups";
import {
  saveTrade,
  savedTradesKey,
  summaryFromTrade,
  type SavedTradeSummary,
} from "../../domain/saved-trades";
import type { TradeSearchQuery } from "../../domain/trade-search";
import type { StressRecipe } from "../../domain/trade-stress";
import { surfaceAppeal } from "../../domain/surface-appeal";
import { SurfaceAppealView } from "../SurfaceAppeal";
import { TradeSearch } from "../TradeSearch";
import { SavedTrades } from "../SavedTrades";
import {
  TradeFiltersButton,
  TradeFiltersDrawer,
  tradeTeamName,
} from "../TradeWorkspace";
import { fmt, signed } from "../../ui/components";
import { ArrowRight } from "lucide-react";

export const tradeTabs = ["manual", "find", "chains", "counters"] as const;
export type TradeTab = (typeof tradeTabs)[number];
const tabLabel: Record<TradeTab, string> = {
  manual: "Manual analyzer",
  find: "Find trades",
  chains: "Chain planner",
  counters: "Counter-offers",
};
export const tradeTabKey = "tradeRoomTab";
export const readTradeTab = (raw?: string): TradeTab =>
  tradeTabs.find((t) => t === raw) ?? "manual";

const maxSide = 5;

// Toggle one player in a side's list, keeping at most five.
const toggle = (ids: string[], id: string) =>
  ids.includes(id)
    ? ids.filter((x) => x !== id)
    : ids.length < maxSide
      ? [...ids, id]
      : ids;

// A pick list of one team's players; selected players are marked and the side is capped at five.
function Picker({
  label,
  players,
  selected,
  change,
}: {
  label: string;
  players: Player[];
  selected: string[];
  change: (ids: string[]) => void;
}) {
  const notify = useFeedback();
  return (
    <div className="gd-picker" role="group" aria-label={label}>
      {players.map((p) => (
        <button
          key={p.id}
          type="button"
          className="gd-opt"
          aria-pressed={selected.includes(p.id)}
          disabled={!selected.includes(p.id) && selected.length >= maxSide}
          onClick={() => {
            notify("select");
            change(toggle(selected, p.id));
          }}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
        >
          <PlayerPhoto player={p} size={20} />
          <span>{p.name}</span>
          <small>
            {p.pos}{" "}
            {p.blendedExpected === null ? "—" : p.blendedExpected.toFixed(1)}
          </small>
        </button>
      ))}
    </div>
  );
}

// Grade-step chips under a side; nothing renders when no position moved.
function Chips({ chips, label }: { chips: GradeChip[]; label: string }) {
  if (chips.length === 0) return null;
  return (
    <div className="gd-chips" role="list" aria-label={label}>
      {chips.map((c) => (
        <span key={c.position} role="listitem">
          <Chip
            tone={c.tone}
            title={`${c.position} grade ${c.before} to ${c.after}`}
          >
            {c.text}
          </Chip>
        </span>
      ))}
    </div>
  );
}

const tagText = (slot: LineupSlot) =>
  slot.tag === null
    ? null
    : typeof slot.tag === "string"
      ? slot.tag
      : `Shifted from ${slot.tag.shiftedFrom}`;

// One lineup slot: the player (opening the card), Expected PPG and a tag only when the slot changed.
function SlotRow({ slot, m }: { slot: LineupSlot; m: Model }) {
  const p = slot.id ? m.byId.get(slot.id) : undefined;
  const tag = tagText(slot);
  return (
    <li
      className="gd-slot"
      data-tag={tag && slot.tag !== "Unfilled" ? "yes" : undefined}
    >
      <b>{slot.slot}</b>
      {p ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
          <PlayerPhoto player={p} size={24} />
          <PlayerName p={p} className="player-link" />
        </span>
      ) : (
        <span className="gd-muted">Unfilled</span>
      )}
      <span className="gd-slot-eppg">{slot.eppg ?? "—"}</span>
      {tag && slot.tag !== "Unfilled" && (
        <Chip
          tone={
            slot.tag === "Leaves" || slot.tag === "To bench"
              ? "negative"
              : "positive"
          }
        >
          {tag}
        </Chip>
      )}
    </li>
  );
}

// The Manual analyzer in the new look: two sides, grade-step chips, the lineup field and four separate verdicts.
function ManualAnalyzer({
  m,
  draft,
  lineupsRaw,
  basis,
  change,
  changeBasis,
  forceTrade,
  onApplyDrop,
  onSwitchToLive,
  state,
  onFilters,
  onSaveTrade,
  initialStress,
  stressRestoreKey,
  manualFiltersOpen,
  setManualFiltersOpen,
}: {
  m: Model;
  draft: Draft;
  lineupsRaw: string | undefined;
  basis: LineupBasis;
  change: (draft: Draft) => void;
  changeBasis: (basis: LineupBasis) => void;
  forceTrade?: (draft: Draft) => { ok: boolean; slot?: number } | boolean;
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
  state?: AppState;
  onFilters?: (patch: Record<string, string>) => void;
  onSaveTrade?: (
    draft: Draft,
    summary: SavedTradeSummary,
    stressTest?: StressRecipe | null,
  ) => boolean;
  initialStress?: StressRecipe;
  stressRestoreKey?: number;
  manualFiltersOpen: boolean;
  setManualFiltersOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const notify = useFeedback();
  const popovers = usePopovers();
  const [view, setView] = useState<"your" | "their">("your"),
    [phase, setPhase] = useState<"before" | "after">("after"),
    [week, setWeek] = useState<number>(m.weeks[0] ?? m.current),
    [forced, setForced] = useState(""),
    [saveMessage, setSaveMessage] = useState(""),
    [stressRecipe, setStressRecipe] = useState<StressRecipe | undefined>(initialStress),
    [lastRestoreKey, setLastRestoreKey] = useState(stressRestoreKey);

  // The forced-trade confirmation clears as soon as a new offer is started.
  if (forced && (draft.give.length > 0 || draft.get.length > 0)) setForced("");

  if (stressRestoreKey !== lastRestoreKey) {
    setLastRestoreKey(stressRestoreKey);
    setStressRecipe(initialStress);
  }
  const result = useMemo(
    () =>
      draft.give.length && draft.get.length
        ? evaluateTrade(m, draft, true, lineupsRaw)
        : null,
    [m, draft, lineupsRaw],
  );
  const valid = result && result.valid ? result : null;
  const impact = valid ? tradeImpact(valid, basis) : null;
  const chips = valid ? gradeStepChips(m, draft, valid) : null;
  const verdictRows = valid ? verdicts(m, valid, basis) : null;
  const surface = useMemo(
    () =>
      valid
        ? surfaceAppeal(
            m,
            draft,
            valid,
            { metric: "both", minimum: 0, requireValueTests: false },
            basis,
            lineupsRaw,
          )
        : undefined,
    [m, draft, valid, basis, lineupsRaw],
  );
  const tape = taleOfTape(m, draft);
  const mineName = str(
    m.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === draft.teamA)
      ?.TeamName,
  );
  const otherTeams = m.dataset.tables.ModelTeams.filter(
    (t) => str(t.TeamID) !== draft.teamA,
  );
  const moves =
    impact && valid
      ? view === "your"
        ? lineupMoves(m, impact.own, week, draft.give, draft.get)
        : lineupMoves(m, impact.other, week, draft.get, draft.give)
      : null;
  const slots = moves ? (phase === "before" ? moves.before : moves.after) : [];
  const forceErrors = scenarioTradeErrors(m, draft);
  const sendPlayer = draft.give[0] ? m.byId.get(draft.give[0]) : undefined;
  const receivePlayer = draft.get[0] ? m.byId.get(draft.get[0]) : undefined;
  const sendColors = sendPlayer ? teamColors(sendPlayer.nfl) : undefined;
  const receiveColors = receivePlayer ? teamColors(receivePlayer.nfl) : undefined;
  return (
    <div className="gd-manual">
      <SimulationNote
        simulation={m.simulation}
        team={[draft.teamA, draft.teamB]}
        onApplyDrop={onApplyDrop}
        onSwitchToLive={onSwitchToLive}
      />
      <div className="gd-sides">
        <section
          className="gd-side gd-side-send"
          aria-label="You send"
          style={
            sendColors
              ? { borderTop: `4px solid ${sendColors.background}` }
              : undefined
          }
        >
          <small>YOU SEND · {mineName}</small>
          <h2>
            {draft.give.length
              ? `${draft.give.length} player${draft.give.length === 1 ? "" : "s"}`
              : "Choose players"}
          </h2>
          {draft.give.length > 0 && (
            <div
              className="gd-side-selected-photos"
              style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}
            >
              {draft.give.map((id) => {
                const p = m.byId.get(id);
                return p ? <PlayerPhoto key={id} player={p} size={32} /> : null;
              })}
            </div>
          )}
          <Picker
            label="Players you send"
            players={m.players.filter((p) => p.owner === draft.teamA)}
            selected={draft.give}
            change={(give) => change({ ...draft, give })}
          />
          {chips && <Chips chips={chips.own} label="Your grade steps" />}
        </section>
        <section className="gd-tape" aria-label="Tale of the tape">
          <h3>Tale of the tape</h3>
          {tape.map((r) => (
            <div key={r.label}>
              <span>{r.send ?? "—"}</span>
              <b>{r.label}</b>
              <span>{r.receive ?? "—"}</span>
            </div>
          ))}
        </section>
        <section
          className="gd-side gd-side-receive"
          aria-label="You receive"
          style={
            receiveColors
              ? { borderTop: `4px solid ${receiveColors.background}` }
              : undefined
          }
        >
          <label className="gd-field">
            <span>YOU RECEIVE · from</span>
            <select
              aria-label="Trade partner"
              value={draft.teamB}
              onChange={(e) =>
                change({ ...draft, teamB: e.target.value, get: [] })
              }
            >
              <option value="">Choose a team</option>
              {otherTeams.map((t) => (
                <option key={str(t.TeamID)} value={str(t.TeamID)}>
                  {str(t.TeamName)}
                </option>
              ))}
            </select>
          </label>
          <h2>
            {draft.get.length
              ? `${draft.get.length} player${draft.get.length === 1 ? "" : "s"}`
              : "Choose players"}
          </h2>
          {draft.get.length > 0 && (
            <div
              className="gd-side-selected-photos"
              style={{ display: "flex", gap: "6px", alignItems: "center", marginBottom: "4px" }}
            >
              {draft.get.map((id) => {
                const p = m.byId.get(id);
                return p ? <PlayerPhoto key={id} player={p} size={32} /> : null;
              })}
            </div>
          )}
          <Picker
            label="Players you receive"
            players={m.players.filter(
              (p) => draft.teamB && p.owner === draft.teamB,
            )}
            selected={draft.get}
            change={(get) => change({ ...draft, get })}
          />
          {chips && <Chips chips={chips.other} label="Their grade steps" />}
        </section>
      </div>

      {/* Forcing a trade clears the offer, so the confirmation lives outside the offer block until a new offer starts. */}
      {forced && (
        <p role="status" className="notice trade-toast gd-muted">
          {forced} <a href="#/roster">Open Roster</a>
        </p>
      )}
      {!result && (
        <p className="gd-muted">
          Choose one to five players on each side to see the verdicts.
        </p>
      )}
      {result && !result.valid && (
        <div className="gd-banner" role="alert">
          {result.errors.join(" ")}
        </div>
      )}

      {valid && (
        <section
          className="trade-score-strip gd-scoring-summary"
          aria-label="Trade scoring summary"
        >
          <div className="trade-score-team">
            <div>
              <strong>{mineName}</strong>
              <small>Your average Expected PPG</small>
            </div>
            <div className="trade-score-values model">
              <span>{fmt(impact?.own.beforePerWeek ?? null)}</span>
              <ArrowRight size={17} aria-hidden="true" />
              <strong>{fmt(impact?.own.afterPerWeek ?? null)}</strong>
              <b>{signed(impact?.own.expectedPerWeek ?? null)}</b>
            </div>
          </div>
          <div className="trade-score-team">
            <div>
              <strong>{tradeTeamName(m, draft.teamB)}</strong>
              <small>Their average Expected PPG</small>
            </div>
            <div className="trade-score-values model">
              <span>{fmt(impact?.other.beforePerWeek ?? null)}</span>
              <ArrowRight size={17} aria-hidden="true" />
              <strong>{fmt(impact?.other.afterPerWeek ?? null)}</strong>
              <b>{signed(impact?.other.expectedPerWeek ?? null)}</b>
            </div>
          </div>
          <div className="trade-score-context-row">
            <small className="trade-score-context">
              Average across Weeks {m.current}–{m.final}; model scoring, not ESPN's weekly projection.
            </small>
            {valid.grade && (
              <span
                className="trade-deal-pill neutral"
                role="status"
                aria-label={`Surplus deal grade: ${valid.grade}`}
              >
                Surplus: <strong>{valid.grade}</strong>
              </span>
            )}
          </div>
        </section>
      )}

      <div className={`trade-manual-filters${manualFiltersOpen ? " filters-open" : ""}`}>
        <TradeFiltersButton
          scope="Manual"
          open={manualFiltersOpen}
          toggle={() => setManualFiltersOpen((o) => !o)}
        />
        <TradeFiltersDrawer
          scope="Manual"
          open={manualFiltersOpen}
          close={() => setManualFiltersOpen(false)}
        >
          <DirectManagerAssessment
            m={m}
            draft={draft}
            result={valid}
            raw={state?.filters.managerExpectations}
            change={(raw) => onFilters?.({ managerExpectations: raw })}
            basis={basis}
            lineupsRaw={lineupsRaw}
          />
        </TradeFiltersDrawer>
      </div>

      {valid && verdictRows && (
        <>
          <section className="gd-verdicts" aria-label="Verdicts">
            {verdictRows.map((v) => (
              <details
                key={v.id}
                className="gd-verdict"
                data-tone={v.tone}
                data-verdict={v.id}
              >
                <summary
                  onClick={(e) => {
                    // Pinned cells on a phone open their detail as a sheet instead of expanding in place.
                    if (!matchMedia("(max-width: 719px)").matches) return;
                    e.preventDefault();
                    popovers.open({
                      title: v.label,
                      width: 520,
                      render: () => (
                        <div className="gd-popover-body">
                          <h2>{v.label}</h2>
                          <p>
                            <strong>{v.summary}</strong>
                          </p>
                          <ul>
                            {v.detail.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      ),
                    });
                  }}
                >
                  <span>{v.label}</span>
                  <strong>{v.summary}</strong>
                </summary>
                {v.bar && (
                  <div
                    className="gd-advbar"
                    data-tone={v.bar.tone}
                    role="img"
                    aria-label={
                      v.bar.value === null
                        ? "Advantage unavailable"
                        : `Advantage ${v.bar.percent ?? "favourable, no percentage"}`
                    }
                  >
                    {v.bar.value !== null && (
                      <i
                        style={{
                          left: `${v.bar.value < 0 ? 50 + v.bar.value * 50 : 50}%`,
                          width: `${Math.abs(v.bar.value) * 50}%`,
                        }}
                      />
                    )}
                    <em>{v.bar.percent ?? ""}</em>
                  </div>
                )}
                <ul>
                  {v.detail.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </details>
            ))}
          </section>

          <section className="gd-field-view" aria-label="Lineup impact">
            <header>
              <h3>Lineup impact</h3>
              <Segmented
                label="Team"
                options={["your", "their"] as const}
                value={view}
                format={(v) => (v === "your" ? "Your team" : "Their team")}
                onChange={setView}
              />
              <Segmented
                label="Phase"
                options={["before", "after"] as const}
                value={phase}
                onChange={setPhase}
              />
              <label className="gd-field inline">
                <span>Week</span>
                <select
                  aria-label="Week"
                  value={week}
                  onChange={(e) => setWeek(Number(e.target.value))}
                >
                  {m.weeks.map((w) => (
                    <option key={w} value={w}>
                      W{w}
                    </option>
                  ))}
                </select>
              </label>
              <Segmented
                label="Lineup basis"
                options={lineupBases}
                value={basis}
                format={(b) => lineupBasisLabel(b)}
                onChange={changeBasis}
              />
            </header>
            <ul className="gd-slots">
              {slots.map((s, i) => (
                <SlotRow key={`${s.slot}-${i}`} slot={s} m={m} />
              ))}
            </ul>
            {moves && moves.notes.length > 0 && (
              <ul className="gd-notes" aria-label="Who moves">
                {moves.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </section>

          <div className="gd-row">
            {forceTrade && (
              <button
                type="button"
                className="gd-cta"
                disabled={forceErrors.length > 0}
                title={forceErrors[0]}
                onClick={() => {
                  const res = forceTrade(draft);
                  const ok = typeof res === "object" ? res.ok : !!res;
                  notify(actionCue(ok));
                  // Say which save slot received the trade, so the auto-save is never a surprise.
                  const slot = typeof res === "object" ? res.slot : undefined;
                  if (ok)
                    setForced(
                      `Applied to a hypothetical roster.${slot ? ` Saved to Slot ${slot}.` : ""} Open Roster to see it.`,
                    );
                }}
              >
                Force this trade into a hypothetical roster
              </button>
            )}
            {onSaveTrade && (
              <button
                type="button"
                className="gd-cta"
                aria-label="Save current trade"
                disabled={!valid}
                onClick={() => {
                  if (valid) {
                    const summary = summaryFromTrade(valid, basis);
                    const ok = onSaveTrade(draft, summary, stressRecipe);
                    notify(actionCue(ok));
                    if (ok) {
                      setSaveMessage(
                        "Trade saved. Duplicate packages update the existing entry while preserving its name, notes and original summary.",
                      );
                    }
                  }
                }}
              >
                Save current trade
              </button>
            )}
            {saveMessage && (
              <span role="status" className="notice trade-toast gd-muted">
                {saveMessage}
              </span>
            )}
          </div>

          <details className="gd-disclosure">
            <summary>Weekly lineup gain</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Your before → after</th>
                    <th>Your gain</th>
                    <th>Their gain</th>
                  </tr>
                </thead>
                <tbody>
                  {impact?.own.weekly.map((w, i) => (
                    <tr key={w.week}>
                      <td>W{w.week}</td>
                      <td>
                        {fmtGain(w.beforeExpected).replace("+", "")} →{" "}
                        {fmtGain(w.afterExpected).replace("+", "")}
                      </td>
                      <td>{fmtGain(w.expectedGain)}</td>
                      <td>
                        {fmtGain(impact.other.weekly[i]?.expectedGain ?? null)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="gd-muted">
              Expected PPG for the lineups on the selected basis; weeks that
              cannot be scored show a dash.
            </p>
          </details>
          <CoverageDetails result={valid} />
          <details className="gd-disclosure">
            <summary>Requirements and conditions</summary>
            <ul>
              <li>
                Surplus package test: {valid.surplusTest}. Needed{" "}
                {valid.requiredSurplus.toFixed(1)}, actual{" "}
                {valid.actualSurplus.toFixed(1)}.
              </li>
              <li>
                Fantasy-points package test: {valid.pointsTest}. Needed{" "}
                {valid.requiredPoints.toFixed(1)}, actual{" "}
                {valid.actualPoints.toFixed(1)}
                {valid.dropCost > 0
                  ? `, including ${valid.dropCost.toFixed(1)} of required-drop replacement cost`
                  : ""}
                .
              </li>
            </ul>
          </details>
          <details className="gd-disclosure">
            <summary>Required changes and optional pickups</summary>
            <ul>
              <li>
                Your drops:{" "}
                {valid.dropsA.map((id) => m.byId.get(id)?.name).join(", ") ||
                  "none"}
              </li>
              <li>
                Their drops:{" "}
                {valid.dropsB.map((id) => m.byId.get(id)?.name).join(", ") ||
                  "none"}
              </li>
              <li>
                Optional waiver pickups for you:{" "}
                {valid.addsA.map((id) => m.byId.get(id)?.name).join(", ") ||
                  "none"}
              </li>
              <li>
                Optional waiver pickups for them:{" "}
                {valid.addsB.map((id) => m.byId.get(id)?.name).join(", ") ||
                  "none"}
              </li>
            </ul>
            <p className="gd-muted">
              Pickups depend on successful claims and are separate from the
              lineup gain above.
            </p>
          </details>
          <details className="gd-disclosure">
            <summary>Market reference</summary>
            <p>{valid.market.status}</p>
            {valid.market.outgoing !== null &&
              valid.market.incoming !== null && (
                <p>
                  {valid.market.source}: sending{" "}
                  {valid.market.outgoing.toFixed(0)} versus receiving{" "}
                  {valid.market.incoming.toFixed(0)}.
                </p>
              )}
          </details>
          <details className="gd-disclosure">
            <summary>Surface assessment</summary>
            {surface ? (
              <SurfaceAppealView value={surface} m={m} />
            ) : (
              <p className="gd-muted">
                Surface assessment requires both teams to have valid modeled rosters.
              </p>
            )}
          </details>
          <TradeStressTest
            key={`${draft.give.join(",")}:${draft.get.join(",")}:${stressRestoreKey ?? 0}`}
            m={m}
            draft={draft}
            plans={lineupsRaw}
            initial={stressRecipe}
            change={setStressRecipe}
          />
        </>
      )}
    </div>
  );
}

// The shared Search limits: one editable section used by Find trades and the Chain planner.
function SearchLimitsSection({
  limits,
  open,
  setOpen,
  change,
}: {
  limits: SearchLimits;
  open: boolean;
  setOpen: (open: boolean) => void;
  change: (next: SearchLimits) => void;
}) {
  const edited = editedLimits(limits);
  const d = defaultSearchLimits;
  return (
    <FoldingGroup
      title="Search limits · shared with chains"
      summary={`Final gain ≥ ${limits.minimumFinalGain.toFixed(1)} · temporary loss ≤ ${limits.maximumTemporaryLoss.toFixed(1)} · recipient loss ≤ ${(limits.maximumRecipientValueLoss * 100).toFixed(0)}% · window ${limits.indexWindow === null ? "Off" : `±${limits.indexWindow}`}`}
      open={open}
      onToggle={setOpen}
      edited={edited.length > 0}
    >
      <div className="gd-limits">
        <RangeSlider
          label="Minimum final gain (EPPG per week)"
          value={limits.minimumFinalGain}
          fallback={d.minimumFinalGain}
          min={0}
          max={10}
          step={0.5}
          onChange={(v) => change({ ...limits, minimumFinalGain: v })}
        />
        <RangeSlider
          label="Maximum temporary loss (EPPG)"
          value={limits.maximumTemporaryLoss}
          fallback={d.maximumTemporaryLoss}
          min={0}
          max={10}
          step={0.5}
          onChange={(v) => change({ ...limits, maximumTemporaryLoss: v })}
        />
        <RangeSlider
          label="Maximum recipient value loss (%)"
          value={Math.round(limits.maximumRecipientValueLoss * 100)}
          fallback={Math.round(d.maximumRecipientValueLoss * 100)}
          min={0}
          max={50}
          step={1}
          format={(v) => `${v}%`}
          onChange={(v) =>
            change({ ...limits, maximumRecipientValueLoss: v / 100 })
          }
        />
        <RangeSlider
          label="Index window (± points)"
          value={limits.indexWindow ?? 0}
          fallback={0}
          min={0}
          max={30}
          step={1}
          format={(v) => (v === 0 ? "Off" : `±${v}`)}
          onChange={(v) =>
            change({ ...limits, indexWindow: v === 0 ? null : v })
          }
        />
        <p className="gd-muted">
          Every search uses these Balanced limits. If a search finds nothing,
          they loosen step by step from your values, and each widened result
          says which limit moved. Price tests never hide a result: results that
          pass every test come first, then price warnings, then widened ones.
          Presets never change these limits.
        </p>
        <button
          type="button"
          className="gd-pill"
          disabled={edited.length === 0}
          onClick={() => change({ ...d })}
        >
          Reset to defaults
        </button>
      </div>
    </FoldingGroup>
  );
}

// Counter-offers: alternatives one swap or one added player away from the offer that still help you, both lineups' change shown.
function CounterOffers({
  m,
  draft,
  basis,
  lineupsRaw,
  use,
}: {
  m: Model;
  draft: Draft;
  basis: LineupBasis;
  lineupsRaw: string | undefined;
  use: (draft: Draft) => void;
}) {
  const notify = useFeedback();
  const journal = useNegotiations();
  const [results, setResults] = useState<CounterResults | null>(null),
    [busy, setBusy] = useState(false),
    [logged, setLogged] = useState("");
  const ready = draft.give.length > 0 && draft.get.length > 0;
  // Results belong to one offer; changing the offer clears them.
  const offerKey = JSON.stringify([draft, basis]);
  const [forKey, setForKey] = useState("");
  const current = results && forKey === offerKey ? results : null;
  const mineName = (id: string) => m.byId.get(id)?.name ?? id;
  return (
    <div className="gd-counters">
      <p className="gd-muted">
        Starting from the offer in the Manual analyzer:{" "}
        {ready
          ? `${draft.give.map(mineName).join(" + ")} for ${draft.get.map(mineName).join(" + ")}`
          : "build an offer there first"}
        . Each counter differs by one swap or one added player and still helps
        your lineup. Counters that help both teams come first.
      </p>
      <button
        type="button"
        className="gd-cta"
        disabled={!ready || busy}
        onClick={() => {
          setBusy(true);
          // Yield once so the button state paints before the search runs.
          setTimeout(() => {
            const next = counterOffers(m, draft, basis, lineupsRaw);
            setResults(next);
            setForKey(offerKey);
            setBusy(false);
            notify(searchCue(next.counters.length > 0));
          }, 20);
        }}
      >
        {busy ? "Searching…" : "Find counter-offers"}
      </button>
      {current && !current.base && (
        <div className="gd-banner" role="alert">
          That offer is not a valid trade, so there is nothing to counter.
        </div>
      )}
      {current?.base && (
        <p>
          Your offer changes your lineup by{" "}
          <b>{fmtGain(current.base.ownGain)}</b> and theirs by{" "}
          <b>{fmtGain(current.base.otherGain)}</b> Expected PPG per week.
        </p>
      )}
      {current?.base && current.counters.length === 0 && (
        <p className="gd-muted">
          No single swap or added player keeps this trade helping you.
        </p>
      )}
      <ul className="gd-counter-list">
        {current?.counters.map((c) => (
          <li
            key={`${c.draft.give.join(",")}>${c.draft.get.join(",")}`}
            className="gd-counter"
          >
            <div>
              <b>{c.description}</b>
              {c.helpsBoth && <Chip tone="positive">Helps both teams</Chip>}
            </div>
            <span>
              You {fmtGain(c.ownGain)}
              {c.ownRange.spread === null
                ? ""
                : ` ± ${c.ownRange.spread.toFixed(1)}`}{" "}
              · Them {fmtGain(c.otherGain)}
            </span>
            <div className="gd-row">
              <button
                type="button"
                className="gd-pill"
                onClick={() => {
                  notify("select");
                  use(c.draft);
                }}
              >
                Use this
              </button>
              <button
                type="button"
                className="gd-pill"
                onClick={async () => {
                  try {
                    const offer = newJournalOffer(
                      m,
                      c.draft,
                      c.draft.teamA,
                      new Date().toISOString(),
                    );
                    await journal.put([
                      {
                        id: crypto.randomUUID(),
                        kind: "offer",
                        payload: {
                          ...offer,
                          notes: `Counter-offer: ${c.description}`,
                        },
                      },
                    ]);
                    setLogged(`Logged to the journal: ${c.description}.`);
                  } catch (e) {
                    setLogged(
                      e instanceof Error
                        ? e.message
                        : "Could not log this counter-offer.",
                    );
                  }
                }}
              >
                Log as counteroffer
              </button>
            </div>
          </li>
        ))}
      </ul>
      {logged && (
        <p role="status" className="gd-muted">
          {logged} <a href="#/journal">Open the journal</a>
        </p>
      )}
    </div>
  );
}

// Optimized future lineups and coverage: the legacy per-team totals, computed only when the disclosure is opened.
function CoverageDetails({
  result,
}: {
  result: Extract<TradeResult, { valid: true }>;
}) {
  const [open, setOpen] = useState(false);
  const row = (label: string, side: typeof result.a) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td>{fmtGain(side.expected)}</td>
      <td>{fmtGain(side.value)}</td>
      <td>{fmtGain(side.waiverExpected)}</td>
      <td>{fmtGain(side.downside)}</td>
    </tr>
  );
  return (
    <details
      className="gd-disclosure"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>Optimized future lineups and coverage</summary>
      {open && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Expected gain (season)</th>
                  <th>Value gain (season)</th>
                  <th>Optional waiver gain</th>
                  <th>Injury downside</th>
                </tr>
              </thead>
              <tbody>
                {row("You", result.a)}
                {row("Them", result.b)}
              </tbody>
            </table>
          </div>
          <p className="gd-muted">
            Value-selected future lineups with required drops, reserve depth and
            injury downside. Waiver fills depend on successful claims and stay
            separate from the lineup gain above.
          </p>
        </>
      )}
    </details>
  );
}

const fmtGain = (x: number | null) =>
  x === null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`;

// The Trade room: tabs for the Manual analyzer, Find trades and the Chain planner, plus the journal.
export function TradeRoom({
  m,
  draft,
  lineupsRaw,
  basisRaw,
  tab,
  setTab,
  change,
  changeBasis,
  forceTrade,
  restoreScenario,
  state,
  filters,
  onFilters,
  onApplyDrop,
  onSwitchToLive,
}: {
  // Saved filter values, for the shared search limits and which groups are open.
  filters: Record<string, string>;
  onFilters: (patch: Record<string, string>) => void;
  m: Model;
  draft: Draft;
  lineupsRaw: string | undefined;
  basisRaw: string | undefined;
  tab: TradeTab;
  setTab: (tab: TradeTab) => void;
  change: (draft: Draft) => void;
  changeBasis: (basis: LineupBasis) => void;
  forceTrade?: (draft: Draft) => { ok: boolean; slot?: number } | boolean;
  restoreScenario?: (scenario?: RosterScenario) => boolean;
  state?: AppState;
  onApplyDrop?: (team: string, playerId: string) => void;
  onSwitchToLive?: () => void;
}) {
  const notify = useFeedback();
  const [savedOpen, setSavedOpen] = useState(false);
  const [manualFiltersOpen, setManualFiltersOpen] = useState(false);
  const [restoredStress, setRestoredStress] = useState<StressRecipe | undefined>(undefined);
  const [stressRestoreKey, setStressRestoreKey] = useState(0);
  const limits = readSearchLimits(filters[searchLimitsKey]),
    open = readOpenGroups(filters[foldedGroupsKey]);
  // Your current grades, so a goal can say which grade it reaches; goals about their team are described without one.
  const myGrades = useMemo(
    () => teamsAssessment(m).get(draft.teamA) ?? [],
    [m, draft.teamA],
  );
  const goalSentence = (rule: Parameters<typeof gradeGoalSentence>[0]) =>
    gradeGoalSentence(
      rule,
      myGrades.find((g) => g.position === rule.position)?.grade ?? null,
    );
  // Filter groups remember being open, separately for each tool.
  const foldMemory = {
    isOpen: (title: string) => !!open[`trade-${tab}:${title}`],
    set: (title: string, next: boolean) => {
      if (!!open[`trade-${tab}:${title}`] === next) return;
      onFilters({
        [foldedGroupsKey]: setGroupOpen(
          filters[foldedGroupsKey],
          `trade-${tab}:${title}`,
          next,
        ),
      });
    },
  };

  const saveSelection = (
    selected: Draft,
    summary: SavedTradeSummary,
    query?: TradeSearchQuery,
    context: Model = m,
    stressTest?: StressRecipe | null,
  ) => {
    try {
      const raw = saveTrade(
        state ?? ({ filters } as unknown as AppState),
        context,
        selected,
        summary,
        query,
        undefined,
        stressTest,
      );
      onFilters({ [savedTradesKey]: raw });
      return true;
    } catch {
      return false;
    }
  };

  const openSaved = () => {
    setSavedOpen((o) => !o);
  };

  return (
    <div className="gd-trade">
      <header className="gd-trade-head">
        <h2>Trade room</h2>
        <div className="gd-tabs" role="tablist" aria-label="Trade tools">
          {tradeTabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                notify("tap");
                setTab(t);
              }}
            >
              {tabLabel[t]}
            </button>
          ))}
        </div>
        <div className="gd-row">
          <button type="button" className="gd-pill" onClick={openSaved}>
            Saved trades
          </button>
          <a className="gd-pill" href="#/journal">
            Journal
          </a>
        </div>
      </header>

      <details
        className="trade-saved-drawer gd-disclosure"
        open={savedOpen}
        onToggle={(e) => setSavedOpen(e.currentTarget.open)}
      >
        <summary>Browse saved trades</summary>
        <SavedTrades
          m={m}
          state={state ?? ({ filters } as unknown as AppState)}
          lineupsRaw={lineupsRaw}
          change={(raw) => onFilters({ [savedTradesKey]: raw })}
          load={(trade) => {
            if (trade.scenario && restoreScenario) {
              restoreScenario(trade.scenario);
            }
            change(trade.draft);
            setRestoredStress(trade.stressTest ?? undefined);
            setStressRestoreKey((k) => k + 1);
            setTab(trade.query ? "find" : "manual");
          }}
        />
      </details>

      {tab === "counters" ? (
        <CounterOffers
          m={m}
          draft={draft}
          basis={readLineupBasis(basisRaw)}
          lineupsRaw={lineupsRaw}
          use={(next) => {
            change(next);
            setTab("manual");
          }}
        />
      ) : tab === "manual" ? (
        <ManualAnalyzer
          m={m}
          draft={draft}
          lineupsRaw={lineupsRaw}
          basis={readLineupBasis(basisRaw)}
          change={change}
          changeBasis={changeBasis}
          forceTrade={forceTrade}
          onApplyDrop={onApplyDrop}
          onSwitchToLive={onSwitchToLive}
          state={state}
          onFilters={onFilters}
          onSaveTrade={(d, s, recipe) => saveSelection(d, s, undefined, m, recipe)}
          initialStress={restoredStress}
          stressRestoreKey={stressRestoreKey}
          manualFiltersOpen={manualFiltersOpen}
          setManualFiltersOpen={setManualFiltersOpen}
        />
      ) : (
        <SearchLimitsContext.Provider value={limits}>
          <GradeGoalContext.Provider value={goalSentence}>
            <FoldMemoryContext.Provider value={foldMemory}>
              <SearchLimitsSection
                limits={limits}
                open={!!open.limits}
                setOpen={(next) =>
                  onFilters({
                    [foldedGroupsKey]: setGroupOpen(
                      filters[foldedGroupsKey],
                      "limits",
                      next,
                    ),
                  })
                }
                change={(next) =>
                  onFilters({ [searchLimitsKey]: writeSearchLimits(next) })
                }
              />
              <p className="gd-muted">
                Every {tabLabel[tab].toLowerCase()} control is below.
              </p>
              <div className="trade-workspace">
                <TradeSearch
                  key={`${m.dataset.hash}/${tab}`}
                  m={m}
                  draft={draft}
                  lineupsRaw={lineupsRaw}
                  change={change}
                  save={saveSelection}
                  lineupBasis={readLineupBasis(basisRaw)}
                  onLineupBasisChange={changeBasis}
                  saveSettings={(raw: string) => onFilters({ tradeSearchSettings: raw })}
                  settingsRaw={filters.tradeSearchSettings}
                  workspaceMode={tab === "chains" ? "chain" : "standard"}
                  onAnalyze={(targetDraft) => {
                    change(targetDraft);
                    setTab("manual");
                  }}
                />
              </div>
            </FoldMemoryContext.Provider>
          </GradeGoalContext.Provider>
        </SearchLimitsContext.Provider>
      )}
    </div>
  );
}
