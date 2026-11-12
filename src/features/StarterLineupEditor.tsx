import { useState } from "react";
import type { Model } from "../domain/valuation";
import { cmpId } from "../domain/contracts";
import { roster, lineup, available } from "../domain/lineups";
import {
  readStarterLineup,
  resetStarterLineup,
  saveStarterLineup,
  starterLineupsKey,
  starterSlotCounts,
  validateStarterIds,
} from "../domain/starter-lineups";
import { fmt } from "../ui/components";
import { PlayerName } from "../ui/PlayerName";
import { PlayerPhoto } from "../ui/PlayerPhoto";

// This editor changes only the app's analysis lineup; imported ESPN roster data stays immutable.
// Rebuilt in Gameday Plus tokens without legacy DataTable: depth chart serves as the full roster view.
export function StarterLineupEditor({
  m,
  team,
  filters,
  change,
}: {
  m: Model;
  team: string;
  filters: Record<string, string>;
  change: (patch: Record<string, string>) => void;
}) {
  const raw = filters[starterLineupsKey],
    saved = readStarterLineup(m, team, raw);
  const [ids, setIds] = useState(saved.ids),
    [message, setMessage] = useState("");
  const errors = validateStarterIds(m, team, ids),
    selected = new Set(ids);
  const players = roster(m, team).map((id) => m.byId.get(id)!);
  const preview = lineup(m, ids, m.current, false, false, "expected");
  const missing = ids.some((id) => m.byId.get(id)?.expected === null);

  // Persist a bounded settings patch through the existing local save and optional Supabase-sync path.
  function persist(value: string) {
    const patch = { ...filters, [starterLineupsKey]: value };
    if (new TextEncoder().encode(JSON.stringify(patch)).length > 52000)
      throw Error("Starter selections exceed available settings sync space.");
    change({ [starterLineupsKey]: value });
  }

  const dirty =
    JSON.stringify([...ids].sort(cmpId)) !==
    JSON.stringify([...saved.ids].sort(cmpId));

  return (
    <section className="gd-starters" aria-label="Your app lineup">
      <h2>Your roster</h2>
      <p className="gd-muted">
        Mark your app starters, then Save lineup. These choices drive direct
        trade impact; they do not change ESPN.
      </p>
      <h3>Manage starters</h3>
      <p className="gd-muted">
        Lineup source: <b>{saved.source}</b>
        {saved.savedUTC
          ? ` · saved ${new Date(saved.savedUTC).toLocaleString()}`
          : ""}
        . Starter slots:{" "}
        {Object.entries(starterSlotCounts(m))
          .map(([pos, count]) => `${pos} ${count}`)
          .join(" · ")}
        .
      </p>
      {[...saved.errors, ...saved.warnings].map((issue) => (
        <p className="notice warning gd-notice" key={issue}>
          {issue}
        </p>
      ))}
      {errors.map((error) => (
        <p className="notice danger gd-notice" role="alert" key={error}>
          {error}
        </p>
      ))}
      {message && (
        <p className="notice danger gd-notice" role="alert">
          {message}
        </p>
      )}
      <p className="model gd-starters-score">
        Current-week starter expected score:{" "}
        <strong>{fmt(errors.length || missing ? null : preview.expected)}</strong>.{" "}
        {preview.unfilled} slots unfilled or unavailable.
      </p>
      <p className="gd-muted">
        Byes and unavailable starters score zero for that week. Future bench
        coverage stays separate. Review this plan after roster or week changes.
      </p>
      {dirty && (
        <p className="notice warning gd-notice">
          Unsaved lineup changes. The trade analyzer uses your saved lineup
          until you choose Save lineup.
        </p>
      )}
      <div className="toolbar gd-starters-toolbar">
        {/* Save and reset are explicit; changing a row never silently changes ESPN or another team's plan. */}
        <button
          className="button primary"
          disabled={!!errors.length}
          onClick={() => {
            try {
              persist(saveStarterLineup(m, team, ids, raw));
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : String(error),
              );
            }
          }}
        >
          Save lineup
        </button>
        <button
          className="subtle"
          onClick={() => {
            try {
              persist(resetStarterLineup(team, raw));
              setIds(readStarterLineup(m, team).ids);
              setMessage("");
            } catch (error) {
              setMessage(
                error instanceof Error ? error.message : String(error),
              );
            }
          }}
        >
          Reset to imported lineup
        </button>
      </div>

      <div className="gd-starters-list" role="list">
        {players
          .slice()
          .sort((a, b) => {
            const aSel = selected.has(a.id) ? 0 : 1;
            const bSel = selected.has(b.id) ? 0 : 1;
            return (
              aSel - bSel ||
              (b.expected ?? -Infinity) - (a.expected ?? -Infinity) ||
              a.name.localeCompare(b.name)
            );
          })
          .map((p) => {
            const isStarter = selected.has(p.id);
            return (
              <div
                key={p.id}
                className="gd-starter-row"
                data-role={isStarter ? "Starter" : "Bench"}
                role="listitem"
              >
                <div className="gd-starter-player">
                  <PlayerPhoto player={p} size={32} />
                  <div className="gd-starter-info">
                    <span className="gd-starter-name">
                      <PlayerName p={p} />
                    </span>
                    <small className="gd-muted">
                      {p.pos} · {p.nfl || "FA"}
                    </small>
                  </div>
                </div>
                <div className="gd-starter-stats">
                  <span className="gd-starter-eppg">
                    <small>EPPG</small>
                    <b>{fmt(p.expected)}</b>
                  </span>
                  <span className="gd-starter-actual">
                    <small>Actual</small>
                    <span>{fmt(p.actual)}</span>
                  </span>
                </div>
                <div className="gd-starter-control">
                  <select
                    aria-label={`Lineup status: ${p.name}`}
                    value={isStarter ? "Starter" : "Bench"}
                    onChange={(e) => {
                      const value = e.target.value;
                      setIds((old) =>
                        value === "Starter"
                          ? [...old, p.id]
                          : old.filter((id) => id !== p.id),
                      );
                      setMessage("");
                    }}
                    className="gd-starter-select"
                  >
                    <option>Bench</option>
                    <option disabled={p.slot === 21}>Starter</option>
                  </select>
                  {p.slot === 21 ? (
                    <small className="fact gd-starter-tag">Imported IR</small>
                  ) : isStarter && !available(m, p, m.current) ? (
                    <small className="muted gd-starter-tag">
                      Bye / unavailable
                    </small>
                  ) : null}
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}
