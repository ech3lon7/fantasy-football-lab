import { useState } from "react";
import type { Model, Player } from "../domain/valuation";
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
import { Panel } from "../ui/layout";
import { DataTable, fmt, playerColumns, type Column } from "../ui/components";

// This small editor changes only the app's analysis lineup; imported ESPN roster data stays immutable.
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
  // Insert one editable column into the existing roster columns instead of maintaining a second roster table.
  const columns: Column<Player>[] = [
    playerColumns[0],
    {
      key: "lineup",
      label: "App lineup",
      kind: "input-text",
      value: (p) => (selected.has(p.id) ? "Starter" : "Bench"),
      render: (p) => (
        <div>
          <select
            aria-label={`Lineup status: ${p.name}`}
            value={selected.has(p.id) ? "Starter" : "Bench"}
            onChange={(e) => {
              const value = e.target.value;
              setIds((old) =>
                value === "Starter"
                  ? [...old, p.id]
                  : old.filter((id) => id !== p.id),
              );
              setMessage("");
            }}
          >
            <option>Bench</option>
            <option disabled={p.slot === 21}>Starter</option>
          </select>
          {p.slot === 21 ? (
            <small className="fact"> Imported IR</small>
          ) : selected.has(p.id) && !available(m, p, m.current) ? (
            <small className="muted"> Bye / unavailable</small>
          ) : null}
        </div>
      ),
    },
    ...playerColumns.slice(1),
  ];
  const dirty =
    JSON.stringify([...ids].sort(cmpId)) !==
    JSON.stringify([...saved.ids].sort(cmpId));
  return (
    <Panel
      title="Your roster"
      note="Mark your app starters, then Save lineup. These choices drive direct trade impact; they do not change ESPN."
    >
      <h3>Manage starters</h3>
      <p>
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
        <p className="notice warning" key={issue}>
          {issue}
        </p>
      ))}
      {errors.map((error) => (
        <p className="notice danger" role="alert" key={error}>
          {error}
        </p>
      ))}
      {message && (
        <p className="notice danger" role="alert">
          {message}
        </p>
      )}
      <p className="model">
        Current-week starter expected score:{" "}
        {fmt(errors.length || missing ? null : preview.expected)}.{" "}
        {preview.unfilled} slots unfilled or unavailable.
      </p>
      <p>
        Byes and unavailable starters score zero for that week. Future bench
        coverage stays separate. Review this plan after roster or week changes.
      </p>
      {dirty && (
        <p className="notice warning">
          Unsaved lineup changes. The trade analyzer uses your saved lineup
          until you choose Save lineup.
        </p>
      )}
      <div className="toolbar">
        {/* Save and reset are explicit; changing a row never silently changes ESPN or another team's plan. */}
        <button
          className="button"
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
      <DataTable
        rows={players}
        columns={columns}
        id={(p) => p.id}
        initialSort="index"
      />
    </Panel>
  );
}
