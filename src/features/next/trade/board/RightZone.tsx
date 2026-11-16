import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { positionGradeScale } from "../../../../domain/trade-search";
import { positions } from "../../../../domain/contracts";
import type { WheelData } from "../wheel/wheel-data";
import type { WheelCategory, WheelOption } from "../wheel/wheel-model";
import { motion, useBoardMotion } from "./board-motion";
import { ChalkPanel } from "./ChalkPanel";
import { PlayerChalkRow } from "./PlayerChalkRow";
import { RollText } from "./RollText";
import { useChalkFlip } from "./useChalkFlip";

const MAX_ROWS = 60;

// One option of a category, written in yellow chalk as a vertical list. Its border is two drawn rectangles: a dashed one that is
// always there and a solid one that is drawn when the option is chosen and erased back to dashed when another is (M6).
function OptionList({
  category,
  optionId,
  onOption,
}: {
  category: WheelCategory;
  optionId: string | null;
  onOption: (id: string) => void;
}) {
  const bm = useBoardMotion();
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef(optionId);
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = optionId;
    if (was === optionId || !root.current) return;
    const solid = (id: string | null) => root.current!.querySelector(`[data-option="${id}"] .gd-zpill-solid`);
    if (optionId) bm.play("pill-on", solid(optionId), motion.pillOn);
    if (was) bm.play("pill-off", solid(was), motion.pillOff, { silent: true });
  }, [optionId]);
  return (
    <div ref={root} className="gd-zr-options" role="menu" aria-label={`${category.label} settings`} data-motion="M3 M6">
      {category.options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="menuitem"
          className="gd-zpill"
          data-option={o.id}
          data-on={o.id === optionId}
          data-motion="M3"
          aria-current={o.id === optionId ? "true" : undefined}
          onClick={() => onOption(o.id)}
        >
          <svg className="gd-zpill-border" aria-hidden="true">
            <rect className="gd-zpill-dashed" x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="12" fill="none" />
            <rect className="gd-zpill-solid" x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="12" fill="none" pathLength={1} data-motion="M6" />
          </svg>
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// The toggles of an option: a check is scribbled beside each one that is on (M5), and smudged out when it goes off. A list longer
// than eight scrolls inside the zone with a fade at its edge.
function ToggleList({ data, option }: { data: WheelData; option: WheelOption }) {
  const bm = useBoardMotion();
  const toggles = data.getToggles(option.id);
  const root = useRef<HTMLDivElement>(null);
  const was = useRef<Record<string, boolean> | null>(null);
  const signature = toggles.map((t) => `${t.key}:${t.on ? 1 : 0}`).join("|");
  useLayoutEffect(() => {
    const now = Object.fromEntries(toggles.map((t) => [t.key, t.on]));
    const old = was.current;
    was.current = now;
    if (!old || !root.current) return;
    for (const t of toggles) {
      if (old[t.key] === t.on) continue;
      const tick = root.current.querySelector(`[data-key="${t.key}"] .gd-ctick`);
      if (t.on) bm.play(`tick-${t.key}`, tick?.querySelector("path"), motion.tickIn);
      else bm.play(`untick-${t.key}`, tick, motion.tickOut);
    }
  }, [signature]);
  return (
    <div ref={root} className="gd-zr-toggles" role="menu" aria-label={`${option.label} options`} data-motion="M5" data-long={toggles.length > 8 || undefined}>
      {toggles.map((t) => (
        <button
          key={t.key}
          type="button"
          role="menuitemcheckbox"
          aria-checked={t.on}
          data-key={t.key}
          className="gd-toggle"
          onClick={() => data.setToggle(option.id, t.key, !t.on)}
        >
          <svg className="gd-ctick" data-on={t.on} viewBox="0 0 20 16" aria-hidden="true" data-motion="M5">
            <path d="M2 9 L7 14 L18 2" pathLength={1} />
          </svg>
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// The value card of a number filter: the value large (click it to type an exact one), a − and a + button, and MIN / MAX for a range.
function ValueCard({
  option,
  valueText,
  handle,
  onHandle,
  onStep,
  onExact,
}: {
  option: WheelOption;
  valueText: string;
  handle: "lo" | "hi";
  onHandle: (handle: "lo" | "hi") => void;
  onStep: (delta: 1 | -1) => void;
  onExact: (typed: number) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const bm = useBoardMotion();
  const input = useRef<HTMLInputElement>(null);
  const done = (apply: boolean) => {
    if (apply && input.current && input.current.value !== "") {
      const clamped = onExact(Number(input.current.value));
      if (clamped) bm.play("exact-shake", input.current, motion.shake);
    }
    setEditing(false);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") done(true);
    else if (event.key === "Escape") done(false);
  };
  return (
    <div className="gd-value-card" data-motion="M7">
      {option.kind === "range" && (
        <div className="gd-minmax" role="group" aria-label="Handle">
          {(["lo", "hi"] as const).map((h) => (
            <button key={h} type="button" className="gd-minmax-button" aria-pressed={handle === h} onClick={() => onHandle(h)}>
              {h === "lo" ? "MIN" : "MAX"}
            </button>
          ))}
        </div>
      )}
      <div className="gd-value-row">
        <button type="button" className="gd-step-button" aria-label="Lower" onClick={() => onStep(-1)}>−</button>
        {editing ? (
          <input
            ref={input}
            className="gd-value-input"
            type="number"
            aria-label="Exact value"
            min={option.min}
            max={option.max}
            step={option.step}
            defaultValue=""
            autoFocus
            onBlur={() => setEditing(false)}
            onKeyDown={keyDown}
          />
        ) : (
          <button
            type="button"
            className="gd-value-big"
            aria-label={`${option.label} value ${valueText}. Click to type an exact value`}
            onClick={() => setEditing(true)}
          >
            {valueText}
          </button>
        )}
        <button type="button" className="gd-step-button" aria-label="Raise" onClick={() => onStep(1)}>+</button>
      </div>
      <p className="gd-value-hint">drag the O on the arc, or use the arrow keys</p>
    </div>
  );
}

// A search over players (Never trade, I get, I give, Exclude): a chalk panel with an underline-only search box and one row per player.
function PlayerPanel({ data, option, query, setQuery }: { data: WheelData; option: WheelOption; query: string; setQuery: (q: string) => void }) {
  const { players, selected } = data.getPlayers(option.id);
  const q = query.trim().toLowerCase();
  const list = useMemo(() => {
    const matches = players.filter((p) => selected.includes(p.id) || !q || `${p.name} ${p.pos} ${p.nfl}`.toLowerCase().includes(q));
    return [...matches]
      .sort((a, b) => (b.blendedExpected ?? -Infinity) - (a.blendedExpected ?? -Infinity))
      .slice(0, MAX_ROWS);
  }, [players, selected.join(","), q]);
  const container = useRef<HTMLDivElement>(null);
  useChalkFlip(container, list.map((p) => String(p.id)));
  const label = option.id === "never" ? "Never trade" : option.label;
  return (
    <ChalkPanel label={option.label} heading={label} count={<RollText motionId="M12" text={`${selected.length} selected`} />}>
      <div className="gd-prow-search" data-slide="">
        <input
          className="gd-chalk-input"
          type="search"
          aria-label="Search players"
          placeholder="type a name, position or team"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div ref={container} className="gd-prow-list" data-motion="M10">
        {list.map((p) => (
          <PlayerChalkRow key={p.id} player={p} selected={selected.includes(p.id)} onToggle={() => data.togglePlayer(option.id, p.id)} />
        ))}
        {!list.length && <p className="gd-zp-empty">no players match</p>}
      </div>
    </ChalkPanel>
  );
}

// The grade-goal editor inside its chalk panel. Goal rows are written in, a changed goal rolls, and a removed one is erased from a
// copy laid where it was (M13); the editor's own logic is untouched.
function GoalsPanel({ label, children }: { label: string; children: ReactNode }) {
  const bm = useBoardMotion();
  const root = useRef<HTMLDivElement>(null);
  const known = useRef<Map<Element, string> | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = [...el.querySelectorAll(".gd-rule")];
    const now = new Map(rows.map((r) => [r, [...r.querySelectorAll("select")].map((s) => (s as HTMLSelectElement).value).join("|")]));
    const old = known.current;
    known.current = now;
    if (!old) return;
    for (const [row, signature] of now) {
      if (!old.has(row)) bm.play("goal-in", row, motion.goalIn);
      else if (old.get(row) !== signature) bm.play(`goal-roll-${[...now.keys()].indexOf(row)}`, row.querySelector(".gd-goal-line"), motion.goalRoll);
    }
  });
  // Before a goal is removed, a copy of its row is laid over it and erased; the real row goes at once.
  const beforeRemove = (event: React.MouseEvent) => {
    const button = (event.target as HTMLElement).closest('button[aria-label$="Remove positional goal"]');
    const row = button?.closest(".gd-rule") as HTMLElement | null;
    const host = root.current;
    if (!row || !host || bm.level() === "off") return;
    const box = host.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    const copy = row.cloneNode(true) as HTMLElement;
    copy.setAttribute("aria-hidden", "true");
    copy.setAttribute("inert", "");
    Object.assign(copy.style, { position: "absolute", left: "0", right: "0", top: `${rect.top - box.top}px`, height: `${rect.height}px`, pointerEvents: "none" });
    host.appendChild(copy);
    const animation = bm.play("goal-out", copy, motion.goalOut);
    if (animation) animation.finished.then(() => copy.remove(), () => copy.remove());
    else copy.remove();
  };
  return (
    <ChalkPanel label={label} heading="Positional grade goals">
      <div ref={root} className="gd-goals-body" data-motion="M13" onClickCapture={beforeRemove} data-slide="">
        {children}
      </div>
    </ChalkPanel>
  );
}

function TeamGradePanel({ data, option }: { data: WheelData; option: WheelOption }) {
  return (
    <ChalkPanel label={option.label} heading={option.label}>
      <button type="button" role="menuitemcheckbox" aria-checked={!!data.teamGrade} className="gd-toggle" data-slide=""
        onClick={() => data.setTeamGrade(data.teamGrade ? null : { position: "QB", ceiling: "C+" })}>
        <svg className="gd-ctick" data-on={!!data.teamGrade} viewBox="0 0 20 16" aria-hidden="true"><path d="M2 9 L7 14 L18 2" pathLength={1} /></svg>
        <span>Only teams graded at or below</span>
      </button>
      {data.teamGrade && (
        <div className="gd-zp-row" data-slide="">
          <select aria-label="Team grade position" value={data.teamGrade.position} onChange={(e) => data.setTeamGrade({ ...data.teamGrade!, position: e.target.value })}>
            {positions.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select aria-label="Team grade ceiling" value={data.teamGrade.ceiling} onChange={(e) => data.setTeamGrade({ ...data.teamGrade!, ceiling: e.target.value })}>
            {positionGradeScale.map((g) => <option key={g}>{g}</option>)}
          </select>
        </div>
      )}
    </ChalkPanel>
  );
}

// The right zone: every option and panel of the open category opens here, never on the wheel.
export function RightZone({
  data,
  category,
  option,
  onOption,
  valueText,
  handle,
  onHandle,
  onStep,
  onExact,
  goalsEditor,
  query,
  setQuery,
}: {
  data: WheelData;
  category: WheelCategory | null;
  option: WheelOption | null;
  onOption: (id: string) => void;
  valueText: string;
  handle: "lo" | "hi";
  onHandle: (handle: "lo" | "hi") => void;
  onStep: (delta: 1 | -1) => void;
  onExact: (typed: number) => boolean;
  goalsEditor: ReactNode;
  query: string;
  setQuery: (q: string) => void;
}) {
  const id = useId();
  return (
    <div className="gd-zr" data-zone="right" id={id} data-motion="M25">
      {category && (
        <div className="gd-zr-content" key={category.id} data-motion="M4 M14">
          {category.options.length > 1 && <OptionList category={category} optionId={option?.id ?? null} onOption={onOption} />}
          {option && (option.kind === "slider" || option.kind === "range") && (
            <ValueCard option={option} valueText={valueText} handle={handle} onHandle={onHandle} onStep={onStep} onExact={onExact} />
          )}
          {option?.kind === "toggles" && <ToggleList key={option.id} data={data} option={option} />}
          {option?.kind === "players" && <PlayerPanel key={option.id} data={data} option={option} query={query} setQuery={setQuery} />}
          {option?.kind === "goals" && <GoalsPanel label={option.label}>{goalsEditor}</GoalsPanel>}
          {option?.kind === "teamgrade" && <TeamGradePanel data={data} option={option} />}
        </div>
      )}
    </div>
  );
}
