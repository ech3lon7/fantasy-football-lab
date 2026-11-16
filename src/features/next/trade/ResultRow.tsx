import { useMemo, useState } from "react";
import type { Model } from "../../../domain/valuation";
import type { SearchRow } from "../../../domain/trade-search";
import { readLineupBasis } from "../../../domain/trade-impact";
import { resultRowView } from "../../../domain/view/search-rows";
import type { GradeChip } from "../../../domain/view/trade-room";
import { PlayerName } from "../../../ui/PlayerName";
import { PlayerPhoto } from "../../../ui/PlayerPhoto";
import type { TradeSearchState } from "./useTradeSearch";

const signedOne = (x: number | null) =>
  x === null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`;

// Grade-step chips for the positions a trade moves; nothing is drawn for a position that did not change.
export function Chips({ chips, label }: { chips: GradeChip[]; label: string }) {
  if (!chips.length) return <span className="gd-quiet">—</span>;
  return (
    <span className="gd-chips" role="list" aria-label={label}>
      {chips.map((c) => (
        <span
          key={c.position}
          role="listitem"
          className="gd-chipg"
          data-tone={c.tone}
          title={`${c.position} grade ${c.before} to ${c.after}`}
        >
          {c.text}
        </span>
      ))}
    </span>
  );
}

// One trade: who moves, both sides' grade steps, your weekly lineup gain with its range, the deal grade and the status.
// Every number is computed by the same functions the Manual analyzer uses.
export function ResultRow({
  model,
  row,
  s,
  canSave,
  onAnalyze,
  variant = false,
}: {
  model: Model;
  row: SearchRow;
  s: TradeSearchState;
  canSave: boolean;
  onAnalyze: () => void;
  variant?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const query = s.appliedSearch.current?.query;
  const plans = s.resultPlans.current;
  const give = row.give ?? query?.give ?? [];
  const view = useMemo(
    () =>
      resultRowView(model, row, {
        teamA: query?.teamA ?? "",
        give,
        basis: readLineupBasis(query?.lineupBasis),
        lineupsRaw: plans,
      }),
    // The row and the executed context define the view.
    [model, row.key],
  );
  const people = (ids: string[]) =>
    ids.map((id, i) => {
      const p = model.byId.get(id);
      return (
        <span key={id}>
          {i > 0 && ", "}
          {p ? <PlayerName p={p} /> : id}
        </span>
      );
    });
  const details = s.job?.lineups?.[row.key];
  return (
    <article
      className="gd-res-grid gd-res-row"
      data-variant={variant || undefined}
    >
      <span className="gd-who">
        <span className="gd-photos">
          {[...give, ...row.get].map((id) => {
            const p = model.byId.get(id);
            return p ? (
              <PlayerPhoto key={id} player={p} size={30} className="gd-photo" />
            ) : null;
          })}
        </span>
        <span>
          {people(give)} <span className="gd-quiet">→</span>{" "}
          <b>{people(row.get)}</b>
          <span className="gd-quiet"> · {view.teamName}</span>
        </span>
      </span>
      {/* Keep each side's weekly gain and the current-week matchup result distinct. */}
      <span className="gd-gain gd-gain-you" data-positive={row.own !== null && row.own > 0} aria-label={`Your EPPG gain ${signedOne(row.own)}`}><b>{signedOne(row.own)}</b></span>
      <span className="gd-gain gd-gain-them" aria-label={`Their EPPG gain ${signedOne(row.other)}`}><b>{signedOne(row.other)}</b></span>
      <span aria-label={`This week ${signedOne(row.filterEvidence?.ownWeekGain ?? null)}`}>{signedOne(row.filterEvidence?.ownWeekGain ?? null)}</span>
      <span className="gd-grade-steps"><Chips chips={view.ownChips} label="Your grade steps" /><Chips chips={view.otherChips} label="Their grade steps" /></span>
      <span>
        <button type="button" className="gd-stag" data-kind={view.status.kind} aria-label="Trade details" aria-expanded={open}
          onClick={() => { setOpen(!open); if (!open) s.inspect(row); }}>
          {view.status.label}
        </button>
      </span>
      <span className="gd-chips">
        <button
          type="button"
          className="gd-cbtn"
          onClick={() => {
            s.load(row);
            onAnalyze();
          }}
        >
          Analyze
        </button>
        {canSave && (
          <button
            type="button"
            className="gd-cbtn"
            onClick={() => s.saveRow(row)}
          >
            {s.savedRow === row.key ? "Saved" : "Save trade"}
          </button>
        )}
      </span>
      {open && (
        <div className="gd-row-detail">
          <p>
            Surplus: {view.surplus} · Lineup source: {s.starter.source}
            {model.ignoreByeWeeks &&
              " · Hypothetical: byes ignored; temporary injury absences ignored; IR excluded"}{" "}
            · Weeks {model.current}–{model.final} · Source refreshed:{" "}
            {model.dataset.sourceUTC
              ? new Date(model.dataset.sourceUTC).toLocaleString()
              : "Unavailable"}
            .
          </p>
          {view.status.detail && <p>{view.status.detail}</p>}
          {details?.error ??
            (details?.details
              ? (["own", "other"] as const).map((side) => (
                  <div key={side}>
                    <b>
                      {side === "own" ? "Your" : "Their"} weekly scoring
                      replacements
                    </b>
                    {details.details![side].weekly.map((week) => (
                      <p key={week.week} className="gd-quiet">
                        Week {week.week}:{" "}
                        {week.changes
                          .map(
                            (c) =>
                              `${c.slot}: ${c.before ? (model.byId.get(c.before)?.name ?? c.before) : "—"} → ${c.after ? (model.byId.get(c.after)?.name ?? c.after) : "—"} (${signedOne(c.gain)})`,
                          )
                          .join("; ") || "No lineup changes"}
                      </p>
                    ))}
                  </div>
                ))
              : "Loading trade details…")}
          {row.warnings.map((w) => (
            <p key={w} className="gd-quiet">
              {w}
            </p>
          ))}
        </div>
      )}
    </article>
  );
}
