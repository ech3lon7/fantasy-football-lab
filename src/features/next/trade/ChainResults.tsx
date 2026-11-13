import { useMemo, useState } from "react";
import type { Draft } from "../../../domain/contracts";
import { str } from "../../../domain/contracts";
import type { Model } from "../../../domain/valuation";
import type { TradeChain } from "../../../domain/trade-chains";
import type { ChainDependencyEvidence } from "../../../domain/chain-plausibility";
import {
  chainResultView,
  type ChainResultView,
} from "../../../domain/view/chain-rows";
import type { ResultRowView } from "../../../domain/view/search-rows";
import type { GainSpread, GradeChip } from "../../../domain/view/trade-room";
import { fmt, signed } from "../../../ui/components";
import { PlayerName } from "../../../ui/PlayerName";
import { SurfaceAppealView } from "../../SurfaceAppeal";
import { ManagerEvidence } from "../../Negotiations";
import type { ChainSearchState } from "./useChainSearch";

const pageStep = 10;

const oneDecimal = (x: number | null) =>
  x === null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}`;

function Chips({ chips, label }: { chips: GradeChip[]; label: string }) {
  if (!chips.length) return <span className="gd-quiet">No grade changes</span>;
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

function Gain({ gain, suffix }: { gain: GainSpread; suffix: string }) {
  return (
    <span className="gd-gain" title={gain.reason || undefined}>
      <b>{oneDecimal(gain.gain)}</b>{" "}
      <small>
        ± {gain.spread === null ? "n/a" : gain.spread.toFixed(1)} {suffix}
        {gain.sharesNflTeam && " (slightly understated)"}
      </small>
    </span>
  );
}

// How trade 1 enables trade 2: the recorded evidence of the connection, never recalculated here.
function DependencyDetails({
  value,
  names,
}: {
  value: ChainDependencyEvidence;
  names: (ids: string[]) => React.ReactNode;
}) {
  return (
    <details>
      <summary>How trade 1 enables trade 2</summary>
      <p className="gd-quiet">
        Route:{" "}
        {value.route === "retrade"
          ? "Meaningful re-trade"
          : value.route === "retain"
            ? "Keep-and-release"
            : "No qualifying dependency"}
        .
      </p>
      <p>Acquired players reoffered: {names(value.retrade.acquired)}.</p>
      <p className="gd-quiet">
        Acquired contribution: {fmt(value.retrade.numerator)} /{" "}
        {fmt(value.retrade.denominator)}{" "}
        {value.retrade.metric === "index"
          ? "surplus index"
          : value.retrade.metric === "points"
            ? "positive remaining-season points (zero-index fallback)"
            : "— unavailable contribution"}
        ;{" "}
        {value.retrade.share === null
          ? "unavailable"
          : `${fmt(value.retrade.share * 100)}%`}
        . Requires ≥ {fmt(value.retrade.required * 100)}%.{" "}
        {value.retrade.passed ? "PASS" : "FAIL"}.
      </p>
      {value.route !== "retrade" && (
        <p className="gd-quiet">
          Trade 2 gain after trade 1 {signed(value.retained.actualSecondGain)}{" "}
          EPPG; alone {signed(value.retained.standaloneSecondGain)}; interaction{" "}
          {signed(value.retained.interactionGain)} (requires ≥{" "}
          {fmt(value.retained.required)}).
          {value.retained.issue ? ` ${value.retained.issue}` : ""}
        </p>
      )}
      <small className="gd-quiet">
        Interaction measures how trade 1 changes the effect of trade 2.
        Thresholds are provisional preferences, not acceptance probabilities.
      </small>
    </details>
  );
}

// The results of a chain search: a summary line, then each chain as two step cards and one connected result card.
export function ChainResults({
  m,
  s,
  canSave,
  onAnalyze,
}: {
  m: Model;
  s: ChainSearchState;
  canSave: boolean;
  onAnalyze: (draft: Draft) => void;
}) {
  const { job, stale, running } = s;
  const result = job?.result;
  const [limit, setLimit] = useState(pageStep);
  const shown = s.chains.slice(0, limit);
  const resultModel = s.resultModel;
  const name = (id: string) => resultModel.byId.get(id);
  const names = (ids: string[]) =>
    ids.length
      ? ids.map((id, i) => (
          <span key={id}>
            {i > 0 && ", "}
            {name(id) ? <PlayerName p={name(id)!} /> : id}
          </span>
        ))
      : "None";
  const teamName = (id: string) =>
    str(
      resultModel.dataset.tables.ModelTeams.find((t) => str(t.TeamID) === id)
        ?.TeamName,
    ) || id;

  const views = useMemo<Map<string, ChainResultView>>(() => {
    const out = new Map<string, ChainResultView>();
    if (!job || job.status === "running") return out;
    for (const chain of s.chains)
      out.set(
        chain.key,
        chainResultView(
          chain,
          { first: s.legContext(chain, 1), second: s.legContext(chain, 2) },
          s.team,
          s.basis,
        ),
      );
    return out;
    // The chains and the executed context define the views.
  }, [job?.context, job?.status, job?.result]);

  const complete = !!job && job.status === "complete" && !stale;
  const kinds = (["connected", "sequential"] as const).filter((kind) =>
    shown.some((c) => (c.kind ?? "connected") === kind),
  );

  const stepCard = (chain: TradeChain, view: ChainResultView, step: 1 | 2) => {
    const v: ResultRowView = view.steps[step - 1];
    const leg = step === 1 ? chain.first : chain.second;
    const key = `${chain.key}:${step}`;
    const detail = s.details[key];
    const row = leg.row;
    return (
      <div key={step} className="gd-leg" data-kind="step">
        <span className="gd-kick">
          Trade {step} · {teamName(leg.draft.teamB)}
        </span>
        <div>
          {names(leg.draft.give)} <span className="gd-quiet">→</span>{" "}
          <b>{names(leg.draft.get)}</b>
        </div>
        <Chips chips={v.ownChips} label={`Trade ${step} your grade steps`} />
        <div className="gd-quiet">
          Lineup <Gain gain={v.gain} suffix="/ wk after this step" /> · surplus{" "}
          {v.surplus}
        </div>
        <span>
          <span className="gd-stag" data-kind={v.status.kind}>
            {v.status.label}
          </span>
          {v.status.detail && (
            <small className="gd-quiet" style={{ display: "block" }}>
              {v.status.detail}
            </small>
          )}
        </span>
        {leg.surface && (
          <div className="gd-quiet">
            Their gain · surface stats{" "}
            {leg.surface.average.gain == null
              ? "unavailable"
              : `${signed(leg.surface.average.gain)} season-average PPG`}
            {leg.surface.projection.gain == null
              ? ""
              : ` · ${signed(leg.surface.projection.gain)} projection`}
            ; your gain {signed(row.own)} EPPG / wk.
          </div>
        )}
        {step === 2 && (
          <p className="gd-quiet">
            Requires trade 1 to be completed first; saved with that roster
            prerequisite.
          </p>
        )}
        <div className="gd-chips">
          <button
            type="button"
            className="gd-cbtn"
            aria-label={`Inspect step ${step}`}
            onClick={() => onAnalyze(leg.draft)}
          >
            Inspect this step
          </button>
          {canSave && (
            <button
              type="button"
              className="gd-cbtn"
              disabled={s.saved.includes(key)}
              onClick={() => s.saveLeg(chain, step)}
            >
              {s.saved.includes(key)
                ? `Step ${step} saved`
                : `Save step ${step}`}
            </button>
          )}
        </div>
        <details
          onToggle={(e) => {
            if (e.currentTarget.open) s.inspect(chain, step);
          }}
        >
          <summary>Step {step} evidence</summary>
          <p className="gd-quiet">
            {teamName(s.team)}: {fmt(row.ownBefore ?? null)} →{" "}
            {fmt(row.ownAfter ?? null)} EPPG ({signed(row.own)}/week).{" "}
            {teamName(leg.draft.teamB)}: {fmt(row.otherBefore ?? null)} →{" "}
            {fmt(row.otherAfter ?? null)} ({signed(row.other)}/week).
          </p>
          {row.other !== null && row.other < 0 && (
            <p className="gd-quiet">
              Acceptance concern: this team loses {fmt(-row.other)} EPPG.
            </p>
          )}
          <p className="gd-quiet">
            Their grade steps:{" "}
            <Chips
              chips={v.otherChips}
              label={`Trade ${step} their grade steps`}
            />
          </p>
          <p className="gd-quiet">
            Their surplus index: give {fmt(leg.recipient.surrenderedIndex)} →
            receive {fmt(leg.recipient.receivedIndex)}. Value concession:{" "}
            {fmt(leg.recipient.lossPct * 100)}% (maximum{" "}
            {fmt(leg.recipient.maximumValueLossPct * 100)}%). Their gain:{" "}
            {signed(leg.recipient.gain)} EPPG (requires ≥{" "}
            {fmt(leg.recipient.minimumGain)}). Recipient checks:{" "}
            {leg.recipient.failures.length ? "FAIL" : "PASS"}.
          </p>
          {leg.indexWindow && (
            <p className="gd-quiet">
              Raw index window: outgoing {fmt(leg.indexWindow.outgoing)};
              incoming {fmt(leg.indexWindow.incoming)}; requires{" "}
              {fmt(leg.indexWindow.minimum)}–{fmt(leg.indexWindow.maximum)}.{" "}
              {leg.indexWindow.passed ? "PASS" : "FAIL"}.
            </p>
          )}
          {leg.fit?.map((fit) => (
            <p key={fit.kind} className="gd-quiet">
              {fit.kind === "surplus"
                ? "Receive from surplus"
                : "Offer into deficit"}
              : {fit.mode} · {fit.match === "any" ? "Any" : "All"} · requires{" "}
              {fit.threshold} or {fit.kind === "surplus" ? "higher" : "lower"}.{" "}
              {fit.positions
                .map(
                  (p) =>
                    `${p.position}: ${p.grade} (${p.qualifies ? "match" : "no match"})`,
                )
                .join("; ")}
              . {fit.matched ? "MATCH" : "NO MATCH"}.
            </p>
          ))}
          {leg.row.manager && (
            <ManagerEvidence
              value={leg.row.manager}
              m={s.legContext(chain, step).model}
              draft={leg.draft}
              allowLog={false}
            />
          )}
          {leg.surface && <SurfaceAppealView value={leg.surface} m={m} />}
          <p className="gd-quiet">
            Your required drops: {names(row.dropsA)}. Their required drops:{" "}
            {names(row.dropsB)}.
          </p>
          {detail &&
            (["own", "other"] as const).map((side) => (
              <div key={side}>
                <b>{side === "own" ? "Your" : "Their"} weekly replacements</b>
                {detail[side].weekly.flatMap((week) =>
                  week.changes.map((change, i) => (
                    <p key={`${week.week}:${i}`} className="gd-quiet">
                      {week.week} · {change.slot}:{" "}
                      {change.before ? names([change.before]) : "Vacant"} →{" "}
                      {change.after ? names([change.after]) : "Vacant"} (
                      {change.gain === null
                        ? "Unavailable"
                        : signed(change.gain)}
                      )
                    </p>
                  )),
                )}
              </div>
            ))}
          {row.warnings.length ? (
            row.warnings.map((warning) => (
              <p key={warning} className="gd-quiet">
                {warning}
              </p>
            ))
          ) : (
            <p className="gd-quiet">No additional model warnings.</p>
          )}
        </details>
      </div>
    );
  };

  return (
    <>
      {job?.error && (
        <div className="gd-status" role="alert">
          <b>Chain search failed. No complete results are available.</b>{" "}
          {job.error}
        </div>
      )}
      {running && (
        <div className="gd-status" role="status" aria-live="polite">
          {job?.stats?.phase ?? "Starting chain search"} ·{" "}
          {job?.stats?.evaluated ?? 0} trades evaluated ·{" "}
          {job?.stats?.firstExplored ?? 0} first steps explored.
          {job?.stats?.limits &&
            ` Evaluation limit: ${job.stats.limits.totalEvaluations.toLocaleString()}; scanned ${job.stats.scanned.toLocaleString()} candidates. Cancel stops the search immediately.`}
        </div>
      )}
      {job?.status === "cancelled" && (
        <div className="gd-status" role="status">
          Chain search cancelled. No roster changes were applied.
        </div>
      )}
      {stale && (
        <div className="gd-status" role="status">
          Chain results are stale. Search again with the current roster and
          controls.
        </div>
      )}
      {s.detailError && (
        <div className="gd-status" role="status">
          {s.detailError}
        </div>
      )}
      <div className="gd-applied">
        {complete && result ? (
          <>
            <b>
              {result.stats.found} qualifying chain
              {result.stats.found === 1 ? "" : "s"} found
            </b>{" "}
            · showing the best {result.chains.length} · {result.stats.evaluated}{" "}
            trades evaluated in {fmt((job!.elapsed ?? 0) / 1000)} seconds
            {result.stats.limited && " · search coverage is incomplete"}
          </>
        ) : (
          "No results yet for the current settings."
        )}
      </div>
      {complete && result && (
        <div className="gd-chips">
          <button
            type="button"
            className="gd-cbtn"
            disabled={job!.query.depth === "deeper"}
            onClick={() => s.search(true)}
          >
            Search deeper (keep results)
          </button>
        </div>
      )}
      {complete && result && !result.chains.length && (
        <p className="gd-empty" role="status">
          {result.stats.limited
            ? "No qualifying chains found within the explored work. This does not prove none exist; try a deeper search or broader sizes and teams."
            : "No chains met every goal within the searched sizes and teams. Loosen a goal or add a team."}
          {result.stats.bestFinalGain !== null &&
            ` Best inspected chain passing the other checks: ${signed(result.stats.bestFinalGain)} EPPG overall.`}
        </p>
      )}
      {kinds.map((kind) => (
        <section
          key={kind}
          aria-label={
            kind === "connected"
              ? "Connected chains"
              : "Independent sequential upgrades"
          }
        >
          <h3>
            {kind === "connected"
              ? "Connected chains"
              : "Independent sequential upgrades"}
          </h3>
          {shown
            .filter((c) => (c.kind ?? "connected") === kind)
            .map((chain, i) => {
              const view = views.get(chain.key);
              if (!view) return null;
              return (
                <article key={chain.key} className="gd-legs">
                  {stepCard(chain, view, 1)}
                  {stepCard(chain, view, 2)}
                  <div className="gd-leg" data-kind="chain">
                    <span className="gd-kick">
                      {kind === "connected"
                        ? "Connected chain result"
                        : "Sequential result"}{" "}
                      · #{i + 1} ·{" "}
                      {chain.mode === "safe" ? "Safe" : "Speculative"}
                    </span>
                    <div className="gd-leg-total">
                      <span className="gd-gain">
                        {oneDecimal(view.gain.gain)}
                        <small>
                          {" "}
                          ±{" "}
                          {view.gain.spread === null
                            ? "n/a"
                            : view.gain.spread.toFixed(1)}{" "}
                          EPPG/wk
                        </small>
                      </span>
                    </div>
                    <Chips chips={view.chips} label="Combined grade steps" />
                    <span>
                      <span className="gd-stag" data-kind={view.status.kind}>
                        {view.status.label}
                      </span>
                      {view.status.detail && (
                        <small
                          className="gd-quiet"
                          style={{ display: "block" }}
                        >
                          {view.status.detail}
                        </small>
                      )}
                    </span>
                    <p className="gd-quiet">
                      Your roster: {fmt(chain.before)} →{" "}
                      {fmt(chain.intermediate)} → {fmt(chain.after)} EPPG.{" "}
                      {chain.mode === "safe"
                        ? "Trade 1 does not reduce scoring even if trade 2 never happens."
                        : `If trade 2 fails, trade 1 leaves you at ${fmt(chain.intermediate)} EPPG (${signed(chain.first.row.own)}).`}
                    </p>
                    {chain.kind !== "sequential" && chain.dependency && (
                      <DependencyDetails
                        value={chain.dependency}
                        names={names}
                      />
                    )}
                    {chain.relaxations?.length ? (
                      <p className="gd-quiet">
                        Relaxed limits: {chain.relaxations.join("; ")}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
        </section>
      ))}
      {s.chains.length > limit && (
        <button
          type="button"
          className="gd-cbtn"
          onClick={() => setLimit(limit + pageStep)}
        >
          Show {Math.min(pageStep, s.chains.length - limit)} more of{" "}
          {s.chains.length - limit}
        </button>
      )}
    </>
  );
}
