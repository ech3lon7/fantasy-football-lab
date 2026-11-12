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
  lineupGainSpread,
  lineupMoves,
  taleOfTape,
  verdicts,
  type LineupSlot,
} from "../../domain/view/trade-room";
import type { Model, Player } from "../../domain/valuation";
import { PlayerPhoto } from "../../ui/PlayerPhoto";
import { useOpenPlayer } from "./PlayerCard";
import { usePopovers } from "../../ui/popover/PopoverStack";
import { teamColors } from "../../domain/view/nfl-colors";
import { Chip } from "../../ui/primitives";
import { TradeStressTest } from "../TradeStressTest";
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

const tagText = (slot: LineupSlot) =>
  slot.tag === null
    ? null
    : typeof slot.tag === "string"
      ? slot.tag
      : `Shifted from ${slot.tag.shiftedFrom}`;

// The Manual analyzer in the new look: two sides, grade-step chips, the lineup field and four separate verdicts.
function ManualAnalyzer({
  m,
  draft,
  lineupsRaw,
  basis,
  change,
  changeBasis: _changeBasis,
  forceTrade,
  onApplyDrop,
  onSwitchToLive,
  state,
  onFilters,
  onSaveTrade,
  initialStress,
  stressRestoreKey,
  manualFiltersOpen: _manualFiltersOpen,
  setManualFiltersOpen: _setManualFiltersOpen,
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
  const popovers = usePopovers();
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
  const openPlayer = useOpenPlayer();
  const tape = taleOfTape(m, draft, true);
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
  const analyzedPlayerIds = useMemo(
    () => [...draft.give, ...draft.get],
    [draft.give, draft.get],
  );

  const giveAdd = useMemo(
    () =>
      m.players
        .filter(
          (p) =>
            p.owner === draft.teamA &&
            !draft.give.includes(p.id) &&
            p.pos !== "K" &&
            p.pos !== "D/ST",
        )
        .slice(0, 5),
    [m.players, draft.teamA, draft.give],
  );

  const getAdd = useMemo(
    () =>
      m.players
        .filter(
          (p) =>
            draft.teamB &&
            p.owner === draft.teamB &&
            !draft.get.includes(p.id) &&
            p.pos !== "K" &&
            p.pos !== "D/ST",
        )
        .slice(0, 5),
    [m.players, draft.teamB, draft.get],
  );

  const gainSpread = useMemo(
    () =>
      impact
        ? lineupGainSpread(m, impact.own, impact.own.expectedPerWeek)
        : null,
    [m, impact],
  );
  const ownGain = impact?.own.expectedPerWeek ?? 0;
  const sp = gainSpread?.spread ?? 0;
  const floor = gainSpread?.floor ?? (ownGain - sp);
  const ceil = gainSpread?.ceiling ?? (ownGain + sp);
  const pc = (v: number) => Math.max(0, Math.min(100, ((v + 15) / 30) * 100));
  const barLeft = pc(floor);
  const barWidth = Math.max(4, pc(ceil) - pc(floor));
  const dotPos = pc(ownGain);
  const zeroPos = pc(0);

  return (
    <div className="gd-manual">
      <SimulationNote
        simulation={m.simulation}
        team={[draft.teamA, draft.teamB]}
        onApplyDrop={onApplyDrop}
        onSwitchToLive={onSwitchToLive}
      />

      {/* 1. Sides and Tale of the tape */}
      <div className="vs gd-sides">
        {/* Left Side: You Send */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
          <section
            className="side gd-side gd-side-send"
            role="group"
            aria-label="Players you send"
            style={{ background: "#3B2F8F" }}
          >
            <span className="kick" style={{ color: "rgba(255, 255, 255, 0.8)", fontSize: "13px", fontWeight: 700, textTransform: "uppercase" }}>
              YOU SEND
            </span>
            <h3>{mineName}</h3>
            {draft.give.map((id) => {
              const p = m.byId.get(id);
              if (!p) return null;
              const pColors = teamColors(p.nfl);
              const eppgText = p.blendedExpected !== null ? p.blendedExpected.toFixed(1) : "—";
              const surplusText = p.index !== null ? Math.round(p.index) : "—";
              return (
                <div key={id} className="tp">
                  <button
                    type="button"
                    onClick={() => openPlayer(p.id, analyzedPlayerIds)}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      cursor: "pointer",
                      display: "inline-flex",
                      borderRadius: "50%",
                      flexShrink: 0,
                    }}
                    aria-label={`View ${p.name}'s card`}
                  >
                    <PlayerPhoto player={p} size={32} />
                  </button>
                  <span
                    className="lab"
                    style={{
                      background: pColors.background,
                      color: "#fff",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 700,
                      fontSize: "12px",
                      flexShrink: 0,
                    }}
                  >
                    {p.nfl}
                  </span>
                  <button
                    type="button"
                    className="nm"
                    onClick={() => openPlayer(p.id, analyzedPlayerIds)}
                  >
                    {p.name}
                  </button>
                  <span
                    className="metric"
                    style={{
                      marginLeft: "auto",
                      fontWeight: 700,
                      fontSize: "15px",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: "2px",
                      flexShrink: 0,
                    }}
                    title={`Expected PPG ${eppgText} / Surplus index ${surplusText}`}
                  >
                    <span>{eppgText}</span>
                    <span style={{ opacity: 0.6 }}>/</span>
                    <span style={{ color: "#FFD60A" }}>{surplusText}</span>
                  </span>
                  <button
                    type="button"
                    className="x"
                    onClick={() => {
                      notify("tap");
                      change({ ...draft, give: draft.give.filter((x) => x !== id) });
                    }}
                    aria-label={`Remove ${p.name}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
              {giveAdd.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="addc"
                  onClick={() => {
                    notify("select");
                    change({ ...draft, give: toggle(draft.give, p.id) });
                  }}
                >
                  + {p.name.split(" ").slice(-1)[0]}
                </button>
              ))}
            </div>
            <details style={{ marginTop: "4px" }}>
              <summary style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "12px", cursor: "pointer" }}>
                All players ({m.players.filter((p) => p.owner === draft.teamA).length})
              </summary>
              <div style={{ marginTop: "8px" }}>
                <Picker
                  label="Players you send"
                  players={m.players.filter((p) => p.owner === draft.teamA)}
                  selected={draft.give}
                  change={(give) => change({ ...draft, give })}
                />
              </div>
            </details>
          </section>
          {chips && chips.own.length > 0 && (
            <div className="gsm">
              {chips.own.map((c) => (
                <span
                  key={c.position}
                  style={{
                    background: c.tone === "positive" ? "var(--gd-positive-bg)" : "var(--gd-negative-bg)",
                    color: c.tone === "positive" ? "var(--gd-positive-ink)" : "var(--gd-negative-ink)",
                  }}
                >
                  {c.text}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Center: Tale of the Tape */}
        <section className="tape card gd-tape" aria-label="Tale of the tape">
          <h4>Tale of the tape</h4>
          {tape.map((r) => (
            <div key={r.label} className="tr">
              <span className="lb">{r.label}</span>
              <div className="bf">
                <div className="l">
                  <i
                    style={{
                      width: `${r.sendPct ?? 0}%`,
                      background: "#3B2F8F",
                    }}
                  />
                </div>
                <div>
                  <i
                    style={{
                      width: `${r.receivePct ?? 0}%`,
                      background: "#8C2F39",
                    }}
                  />
                </div>
              </div>
              <div className="bf">
                <span className="num" style={{ textAlign: "right" }}>
                  {r.send ?? "—"}
                </span>
                <span className="num">{r.receive ?? "—"}</span>
              </div>
            </div>
          ))}
        </section>

        {/* Right Side: You Receive */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
          <section
            className="side gd-side gd-side-receive"
            style={{ background: "#8C2F39" }}
          >
            <select
              className="visually-hidden"
              aria-label="Trade partner"
              value={draft.teamB}
              onChange={(e) => change({ ...draft, teamB: e.target.value, get: [] })}
            >
              {otherTeams.map((t) => (
                <option key={str(t.TeamID)} value={str(t.TeamID)}>
                  {str(t.TeamName)}
                </option>
              ))}
            </select>
            <span className="kick" style={{ color: "rgba(255, 255, 255, 0.8)", fontSize: "13px", fontWeight: 700, textTransform: "uppercase" }}>
              YOU RECEIVE
            </span>
            <div role="group" aria-label="Opponent teams" style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "4px" }}>
              {otherTeams.map((t) => {
                const tid = str(t.TeamID);
                const isSelected = tid === draft.teamB;
                return (
                  <button
                    key={tid}
                    type="button"
                    className="addc"
                    style={{
                      borderStyle: "solid",
                      background: isSelected ? "rgba(255, 255, 255, 0.25)" : "transparent",
                    }}
                    aria-pressed={isSelected}
                    onClick={() => {
                      notify("select");
                      change({ ...draft, teamB: tid, get: [] });
                    }}
                  >
                    {str(t.TeamName)}
                  </button>
                );
              })}
            </div>
            <div role="group" aria-label="Players you receive">
            {draft.get.map((id) => {
              const p = m.byId.get(id);
              if (!p) return null;
              const pColors = teamColors(p.nfl);
              const eppgText = p.blendedExpected !== null ? p.blendedExpected.toFixed(1) : "—";
              const surplusText = p.index !== null ? Math.round(p.index) : "—";
              return (
                <div key={id} className="tp">
                  <button
                    type="button"
                    onClick={() => openPlayer(p.id, analyzedPlayerIds)}
                    style={{
                      background: "none",
                      border: 0,
                      padding: 0,
                      cursor: "pointer",
                      display: "inline-flex",
                      borderRadius: "50%",
                      flexShrink: 0,
                    }}
                    aria-label={`View ${p.name}'s card`}
                  >
                    <PlayerPhoto player={p} size={32} />
                  </button>
                  <span
                    className="lab"
                    style={{
                      background: pColors.background,
                      color: "#fff",
                      padding: "2px 8px",
                      borderRadius: "6px",
                      fontWeight: 700,
                      fontSize: "12px",
                      flexShrink: 0,
                    }}
                  >
                    {p.nfl}
                  </span>
                  <button
                    type="button"
                    className="nm"
                    onClick={() => openPlayer(p.id, analyzedPlayerIds)}
                  >
                    {p.name}
                  </button>
                  <span
                    className="metric"
                    style={{
                      marginLeft: "auto",
                      fontWeight: 700,
                      fontSize: "15px",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "baseline",
                      gap: "2px",
                      flexShrink: 0,
                    }}
                    title={`Expected PPG ${eppgText} / Surplus index ${surplusText}`}
                  >
                    <span>{eppgText}</span>
                    <span style={{ opacity: 0.6 }}>/</span>
                    <span style={{ color: "#FFD60A" }}>{surplusText}</span>
                  </span>
                  <button
                    type="button"
                    className="x"
                    onClick={() => {
                      notify("tap");
                      change({ ...draft, get: draft.get.filter((x) => x !== id) });
                    }}
                    aria-label={`Remove ${p.name}`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
              {getAdd.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="addc"
                  onClick={() => {
                    notify("select");
                    change({ ...draft, get: toggle(draft.get, p.id) });
                  }}
                >
                  + {p.name.split(" ").slice(-1)[0]}
                </button>
              ))}
            </div>
            {draft.teamB && (
              <details style={{ marginTop: "4px" }}>
                <summary style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: "12px", cursor: "pointer" }}>
                  All opponent players ({m.players.filter((p) => p.owner === draft.teamB).length})
                </summary>
                <div style={{ marginTop: "8px" }}>
                  <Picker
                    label="Players you receive"
                    players={m.players.filter((p) => p.owner === draft.teamB)}
                    selected={draft.get}
                    change={(get) => change({ ...draft, get })}
                  />
                </div>
              </details>
            )}
            </div>
          </section>
          {chips && chips.other.length > 0 && (
            <div className="gsm">
              {chips.other.map((c) => (
                <span
                  key={c.position}
                  style={{
                    background: c.tone === "positive" ? "var(--gd-positive-bg)" : "var(--gd-negative-bg)",
                    color: c.tone === "positive" ? "var(--gd-positive-ink)" : "var(--gd-negative-ink)",
                  }}
                >
                  {c.text}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Force trade button */}
      {forceTrade && (
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", margin: "16px 0" }}>
          <button
            type="button"
            className="ibtn"
            style={{ borderColor: "var(--gd-edit)", color: "var(--gd-edit)", fontWeight: 700, padding: "8px 14px", borderRadius: "10px" }}
            aria-label="Force this trade into a hypothetical roster"
            disabled={forceErrors.length > 0}
            title={forceErrors[0]}
            onClick={() => {
              const res = forceTrade(draft);
              const ok = typeof res === "object" ? res.ok : !!res;
              notify(actionCue(ok));
              const slot = typeof res === "object" ? res.slot : undefined;
              if (ok) {
                setForced(
                  `Applied to a hypothetical roster.${slot ? ` Saved to Slot ${slot}.` : ""} Open Roster to see it.`,
                );
              }
            }}
          >
            ■ Force this trade into a hypothetical roster
          </button>
          <span className="quiet" style={{ fontSize: "13.5px" }}>
            Creates a simulation with these players moved, whatever the verdict says. Manage it under Roster.
          </span>
        </div>
      )}

      {forced && (
        <p role="status" className="notice trade-toast gd-muted" style={{ margin: "8px 0" }}>
          {forced} <a href="#/roster">Open Roster</a>
        </p>
      )}
      {!result && (
        <p className="gd-muted" style={{ margin: "12px 0" }}>
          Choose one to five players on each side to see the verdicts.
        </p>
      )}
      {result && !result.valid && (
        <div className="gd-banner" role="alert" style={{ margin: "12px 0" }}>
          {result.errors.join(" ")}
        </div>
      )}

      {/* 2. Lineup impact football field */}
      <section role="region" aria-label="Lineup impact">
        <h2
          className="sec"
          style={{
            fontFamily: "var(--gd-font-display)",
            fontWeight: 800,
            fontSize: "24px",
            textTransform: "uppercase",
            margin: "20px 0 10px",
          }}
        >
          / Lineup impact · who starts, who shifts, who sits
        </h2>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
        <div className="seg" role="group" aria-label="Team">
          <button type="button" aria-pressed={view === "your"} onClick={() => setView("your")}>
            Your team
          </button>
          <button type="button" aria-pressed={view === "their"} onClick={() => setView("their")}>
            Their team
          </button>
        </div>
        <div className="seg" role="group" aria-label="Phase">
          <button type="button" aria-pressed={phase === "before"} onClick={() => setPhase("before")}>
            Before
          </button>
          <button type="button" aria-pressed={phase === "after"} onClick={() => setPhase("after")}>
            After
          </button>
        </div>
        <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span className="quiet">Week</span>
          <select
            className="sel"
            aria-label="Week"
            value={week}
            onChange={(e) => setWeek(Number(e.target.value))}
          >
            {m.weeks.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <span className="quiet" style={{ marginLeft: "auto", fontSize: "13px" }}>
          Circles stand in for the player card pictures used today.
        </span>
      </div>

      <div className="field" aria-label="Lineup slots">
        {slots
          .filter((s) => s.slot !== "K" && s.slot !== "D/ST")
          .map((sl, i) => {
            const p = sl.id ? m.byId.get(sl.id) : undefined;
            const pColors = p ? teamColors(p.nfl) : undefined;
            const initials = p ? p.name.split(" ").map((w) => w[0]).join("") : "—";
            const tag = tagText(sl);
            const tagCls =
              tag === "New"
                ? "t-new"
                : tag?.startsWith("Shifted")
                  ? "t-shift"
                  : tag === "Up from bench"
                    ? "t-up"
                    : "t-out";
            return (
              <button
                key={`${sl.slot}-${i}`}
                type="button"
                className={`slot ${sl.id ? "" : "empty"} gd-slot`}
                onClick={() => {
                  if (p) {
                    notify("select");
                    openPlayer(p.id, analyzedPlayerIds);
                  }
                }}
              >
                <span className="sn">{sl.slot}</span>
                <span
                  className="av"
                  style={{ background: pColors?.background ?? "#2A7449" }}
                >
                  {initials}
                </span>
                <span className="pn">{sl.name || "Unfilled"}</span>
                <span className="num" style={{ color: "var(--gd-model)", fontWeight: 700 }}>
                  {sl.eppg ?? "0.0"}
                </span>
                {tag && sl.tag !== "Unfilled" && (
                  <span className={`stag ${tagCls}`}>{tag.toUpperCase()}</span>
                )}
              </button>
            );
          })}
      </div>

      {moves && moves.notes.length > 0 && (
        <div
          className="card"
          style={{
            marginTop: "12px",
            padding: "14px 18px",
            border: "2px solid var(--gd-line)",
            borderRadius: "14px",
            background: "var(--gd-surface)",
          }}
        >
          <span
            className="kick"
            style={{
              color: "var(--gd-muted)",
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            What changes in the lineup
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
            {moves.notes.map((note, i) => {
              let badge = "INFO";
              let badgeCls = "t-shift";
              if (note.includes("comes off the bench") || note.includes("moves up")) {
                badge = "UP";
                badgeCls = "t-up";
              } else if (
                note.includes("starts at") ||
                note.includes("joins") ||
                note.includes("replaces")
              ) {
                badge = "NEW";
                badgeCls = "t-new";
              } else if (note.includes("shifts")) {
                badge = "SHIFT";
                badgeCls = "t-shift";
              } else if (note.includes("leaves in the trade")) {
                badge = "OUT";
                badgeCls = "t-out";
              } else if (note.includes("replaced") || note.includes("moves to the bench")) {
                badge = "SITS";
                badgeCls = "t-out";
              }
              return (
                <div key={i} style={{ display: "flex", gap: "10px", alignItems: "baseline", fontSize: "14px" }}>
                  <span className={`stag ${badgeCls}`}>{badge}</span>
                  <span>{note}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </section>

      {/* 3. The verdict four calls scoreboard */}
      {valid && (
        <section className="score" role="region" aria-label="Verdicts">
          <h2
            className="sec"
            style={{
              fontFamily: "var(--gd-font-display)",
              fontWeight: 800,
              fontSize: "24px",
              textTransform: "uppercase",
              margin: "24px 0 10px",
            }}
          >
            / The verdict · four separate calls
          </h2>
          <div className="srow">
            <span className="n">▲ Surplus exchange</span>
          <span
            className="v"
            style={{
              color: valid
                ? valid.surplusTest === "PASS"
                  ? "var(--gd-positive-ink)"
                  : valid.surplusTest === "FAIL"
                    ? "var(--gd-negative-ink)"
                    : "inherit"
                : "inherit",
            }}
          >
            {valid ? valid.grade || (valid.surplusTest === "PASS" ? "Gain" : "Overpay") : "—"}
          </span>
          <div className="d">
            {valid
              ? `Positive VORP in ${valid.incoming.toFixed(1)} vs out ${valid.outgoing.toFixed(1)} (${valid.incoming >= valid.outgoing ? "+" : ""}${(valid.incoming - valid.outgoing).toFixed(1)}). Premium only applies to unequal packages.`
              : "Choose players on both sides to evaluate surplus."}
            {/* Render the existing surplus advantage without mixing it with lineup gain. */}
            {verdictRows?.[0].bar && (
              <div className="gd-advbar" data-tone={verdictRows[0].bar.tone}
                aria-label={"Advantage " + (verdictRows[0].bar.percent ?? "unavailable")}>
                <i style={{
                  left: (50 + Math.min(0, verdictRows[0].bar.value ?? 0) * 50) + "%",
                  width: Math.abs(verdictRows[0].bar.value ?? 0) * 50 + "%",
                }} />
                <em>{verdictRows[0].bar.percent ?? "—"}</em>
              </div>
            )}
          </div>
        </div>
        <div className="srow">
          <span className="n">▲ Lineup impact</span>
          <span
            className="v num"
            style={{
              color:
                ownGain > 0
                  ? "var(--gd-positive-ink)"
                  : ownGain < 0
                    ? "var(--gd-negative-ink)"
                    : "inherit",
            }}
          >
            {impact?.own.expectedPerWeek !== null && impact?.own.expectedPerWeek !== undefined
              ? `${impact.own.expectedPerWeek >= 0 ? "+" : ""}${impact.own.expectedPerWeek.toFixed(1)}`
              : "—"}
          </span>
          <div className="d">
            Expected PPG gain for the Value PPG-selected lineup, per remaining week. Not a weekly guarantee.
            {gainSpread && (
              <div style={{ margin: "8px 0 4px", maxWidth: "520px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "13.5px" }}>
                  <span>Lineup gain ± spread</span>
                  <span className="num">
                    {ownGain >= 0 ? "+" : ""}{ownGain.toFixed(1)} {gainSpread.spread !== null ? `± ${gainSpread.spread.toFixed(1)}` : ""}
                  </span>
                </div>
                <div className="whisk" style={{ height: "12px", marginTop: "4px" }}>
                  <i style={{ left: `${barLeft}%`, width: `${barWidth}%` }} />
                  <b style={{ left: `${dotPos}%` }} />
                  <b style={{ left: `${zeroPos}%`, background: "var(--gd-muted)", width: "2px" }} />
                </div>
                <div className="quiet" style={{ display: "flex", justifyContent: "space-between", fontSize: "12.5px" }}>
                  <span>Floor {gainSpread.floor !== null ? (gainSpread.floor >= 0 ? `+${gainSpread.floor.toFixed(1)}` : gainSpread.floor.toFixed(1)) : "—"}</span>
                  <span>grey line = 0</span>
                  <span>Ceiling {gainSpread.ceiling !== null ? (gainSpread.ceiling >= 0 ? `+${gainSpread.ceiling.toFixed(1)}` : gainSpread.ceiling.toFixed(1)) : "—"}</span>
                </div>
                <div style={{ fontSize: "11.5px", color: "var(--gd-muted)" }}>
                  {gainSpread.players.length} lineup spots change. Spreads are combined as independent (root of summed squares), which slightly understates the range when two of those players share an NFL team.
                </div>
              </div>
            )}
            <div className="wks">
              {impact?.own.weekly.map((w) => {
                const g =
                  w.afterExpected !== null && w.beforeExpected !== null
                    ? w.afterExpected - w.beforeExpected
                    : null;
                const bg =
                  g === null
                    ? "var(--gd-surface-2)"
                    : g >= 0
                      ? "rgba(17,128,91,0.2)"
                      : "rgba(217,83,79,0.2)";
                const fg =
                  g === null
                    ? "var(--gd-muted)"
                    : g >= 0
                      ? "var(--gd-positive-ink)"
                      : "var(--gd-negative-ink)";
                return (
                  <span key={w.week} style={{ background: bg, color: fg }}>
                    W {w.week} {g !== null ? (g >= 0 ? `+${g.toFixed(1)}` : g.toFixed(1)) : "—"}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
        <div className="srow">
          <span className="n">■ Legality</span>
          <span
            className="v"
            style={{
              color: valid?.legality ? "var(--gd-positive-ink)" : "var(--gd-negative-ink)",
            }}
          >
            {valid ? (valid.legality ? "Legal" : "Needs changes") : "—"}
          </span>
          <div className="d">
            {valid
              ? valid.legality
                ? "Ownership, duplicates, roster capacity, position limits and IR all hold for both teams."
                : valid.errors.join(" ")
              : "Evaluates roster size, duplicate players and position constraints."}
          </div>
        </div>
        <div className="srow">
          <span className="n">● Uncertainty</span>
          <span
            className="v"
            style={{
              color: valid?.uncertainty.length ? "var(--gd-warning-ink)" : "var(--gd-ink)",
            }}
          >
            {valid ? (valid.uncertainty.length ? "Review" : "Low") : "—"}
          </span>
          <div className="d">
            {valid
              ? valid.uncertainty.length
                ? valid.uncertainty.join(" ")
                : "No injury, sample or baseline concerns."
              : "Identifies injury, small sample or baseline estimation concerns."}
          </div>
        </div>
      </section>
      )}

      {/* Pinned four verdict cells for phone width */}
      {valid && verdictRows && (
        <section className="gd-verdicts gd-phone-only" aria-label="Verdicts">
          {verdictRows.map((v) => (
            <details
              key={v.id}
              className="gd-verdict"
              data-tone={v.tone}
              data-verdict={v.id}
            >
              <summary
                onClick={(e) => {
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
              <ul>
                {v.detail.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      )}

      {/* 4. Detail disclosures */}
      <div style={{ marginTop: "24px", display: "flex", flexDirection: "column", gap: "10px" }}>
        {valid && (
          <details className="gd-disclosure">
            <summary>Trade scoring summary</summary>
            <section
              className="trade-score-strip gd-scoring-summary"
              aria-label="Trade scoring summary"
              style={{ marginTop: "10px" }}
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
          </details>
        )}

        <details className="gd-disclosure">
          <summary>Surface assessment & manager expectations</summary>
          <div style={{ marginTop: "10px" }}>
            {surface ? (
              <SurfaceAppealView value={surface} m={m} />
            ) : (
              <p className="gd-muted">
                Surface assessment requires both teams to have valid modeled rosters.
              </p>
            )}
            <div style={{ marginTop: "14px" }}>
              <DirectManagerAssessment
                m={m}
                draft={draft}
                result={valid}
                raw={state?.filters.managerExpectations}
                change={(raw) => onFilters?.({ managerExpectations: raw })}
                basis={basis}
                lineupsRaw={lineupsRaw}
              />
            </div>
          </div>
        </details>

        {valid && (
          <>
            <details className="gd-disclosure">
              <summary>Weekly lineup gain table</summary>
              <div className="table-wrap" style={{ marginTop: "10px" }}>
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
                    {impact?.own.weekly.map((w, i) => {
                      const gOwn =
                        w.afterExpected !== null && w.beforeExpected !== null
                          ? w.afterExpected - w.beforeExpected
                          : null;
                      const otherW = impact.other.weekly[i];
                      const gOther =
                        otherW && otherW.afterExpected !== null && otherW.beforeExpected !== null
                          ? otherW.afterExpected - otherW.beforeExpected
                          : null;
                      return (
                        <tr key={w.week}>
                          <td>W{w.week}</td>
                          <td>
                            {w.beforeExpected !== null ? w.beforeExpected.toFixed(1) : "—"} →{" "}
                            {w.afterExpected !== null ? w.afterExpected.toFixed(1) : "—"}
                          </td>
                          <td>{gOwn !== null ? `${gOwn >= 0 ? "+" : ""}${gOwn.toFixed(1)}` : "—"}</td>
                          <td>{gOther !== null ? `${gOther >= 0 ? "+" : ""}${gOther.toFixed(1)}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>

            <CoverageDetails result={valid} />

            <details className="gd-disclosure">
              <summary>Requirements and conditions</summary>
              <ul style={{ marginTop: "8px" }}>
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
              <ul style={{ marginTop: "8px" }}>
                <li>
                  Your drops:{" "}
                  {valid.dropsA.map((id) => m.byId.get(id)?.name).join(", ") || "none"}
                </li>
                <li>
                  Their drops:{" "}
                  {valid.dropsB.map((id) => m.byId.get(id)?.name).join(", ") || "none"}
                </li>
                <li>
                  Optional waiver pickups for you:{" "}
                  {valid.addsA.map((id) => m.byId.get(id)?.name).join(", ") || "none"}
                </li>
                <li>
                  Optional waiver pickups for them:{" "}
                  {valid.addsB.map((id) => m.byId.get(id)?.name).join(", ") || "none"}
                </li>
              </ul>
            </details>

            <details className="gd-disclosure">
              <summary>Stress test & save trade</summary>
              <div style={{ marginTop: "10px" }}>
                <div className="gd-row" style={{ marginBottom: "12px" }}>
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
                <TradeStressTest
                  key={`${draft.give.join(",")}:${draft.get.join(",")}:${stressRestoreKey ?? 0}`}
                  m={m}
                  draft={draft}
                  plans={lineupsRaw}
                  initial={stressRecipe}
                  change={setStressRecipe}
                />
              </div>
            </details>
          </>
        )}
      </div>
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

  const [savedOpen, setSavedOpen] = useState(false);
  const openSaved = () => {
    setSavedOpen((o) => !o);
  };

  return (
    <div className="gd-trade">
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "12px" }} className="slide">
        <span className="kick" style={{ color: "var(--gd-muted)", fontSize: "14px", fontWeight: 700, textTransform: "uppercase" }}>
          Analyze · find · chain
        </span>
        <h1 className="h-hero" style={{ fontSize: "54px", margin: 0 }}>
          Trade room
        </h1>
      </div>

      <header className="gd-trade-head" style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center", marginBottom: "16px" }}>
        <div className="ptabs gd-tabs" role="tablist" aria-label="Trade tools" style={{ flex: "1 1 420px" }}>
          {tradeTabs.map((t) => (
            <button
              key={t}
              type="button"
              className="ptab"
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
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="quiet" style={{ fontSize: "13.5px" }}>Evaluate lineup impact using</span>
            <select
              className="sel"
              aria-label="Lineup basis"
              value={basisRaw}
              onChange={(e) => changeBasis(e.target.value as LineupBasis)}
            >
              {lineupBases.map((b) => (
                <option key={b} value={b}>
                  {lineupBasisLabel(b)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="pill cbtn gd-pill" onClick={openSaved}>
            Saved trades
          </button>
          <a className="pill cbtn gd-pill" href="#/journal">
            Journal
          </a>
        </div>
      </header>

      <details
        className="trade-saved-drawer gd-disclosure"
        open={savedOpen}
        onToggle={(e) => setSavedOpen(e.currentTarget.open)}
        style={{
          display: savedOpen ? "block" : "none",
          marginBottom: "16px",
          background: "var(--gd-surface)",
          border: "2px solid var(--gd-line)",
          borderRadius: "14px",
          padding: "16px",
        }}
      >
        <summary style={{ display: "none" }}>Browse saved trades</summary>
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
            setSavedOpen(false);
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
