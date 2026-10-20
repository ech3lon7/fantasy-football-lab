import { useEffect, useState, type ChangeEvent } from "react";
import type { Model } from "../domain/valuation";
import {
  evidenceKey,
  roleScenarioKey,
  parseEvidence,
} from "../domain/opportunity";
import { Panel, Select } from "../ui/layout";
import { DataTable, fmt } from "../ui/components";

// Optional source data uses the existing account-scoped settings sync, never a retained CSV file.
export function EvidenceSettings({
  m,
  filters,
  change,
}: {
  m: Model;
  filters: Record<string, string>;
  change: (p: Record<string, string>) => void;
}) {
  const [message, setMessage] = useState("");
  const [player, setPlayer] = useState("");
  const [roleWeight, setRoleWeight] = useState(String(m.roleScenarioWeight));
  // Adopt synced scenario controls without retaining another snapshot's stale display.
  useEffect(
    () => setRoleWeight(String(m.roleScenarioWeight)),
    [m.roleScenarioWeight],
  );
  function save(rows: Record<string, unknown>[]) {
    try {
      const next = parseEvidence(rows, m.dataset);
      const patch = { ...filters, [evidenceKey]: JSON.stringify(next) };
      if (new TextEncoder().encode(JSON.stringify(patch)).length > 52000)
        throw Error(
          "Evidence exceeds the available sync space; use fewer player-week rows.",
        );
      change({ [evidenceKey]: patch[evidenceKey] });
      setMessage(
        `Saved ${next.rows.length} player-week evidence rows for this snapshot.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  // Read a bounded CSV, validate every record, and replace evidence only after all rows pass.
  async function importCSV(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 50000) throw Error("Use a CSV smaller than 50 KB.");
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.text(), {
        type: "string",
        raw: true,
        cellFormula: false,
      });
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        book.Sheets[book.SheetNames[0]],
        { raw: true, defval: null },
      );
      save(rows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  // A return week is a transparent user scenario, not an inferred medical recovery estimate.
  function returnScenario(week: string) {
    if (!player) return;
    const rows = m.supplementalInput.rows.map((r) => ({ ...r }));
    let row = rows.find((r) => r.PlayerID === player && r.Week === m.current);
    if (!row && week) {
      row = {
        PlayerID: player,
        Week: m.current,
        Source: "User-selected return scenario",
        AsOfUTC: new Date().toISOString(),
      };
      rows.push(row);
    }
    if (row) {
      if (week) row.ReturnWeek = Number(week);
      else delete row.ReturnWeek;
    }
    save(
      rows.filter((r) =>
        Object.keys(r).some(
          (k) =>
            !["PlayerID", "Week", "Source", "AsOfUTC", "MarketFormat"].includes(
              k,
            ),
        ),
      ),
    );
  }

  return (
    <>
      <Panel
        title="Opportunity and market data"
        note="Weekly carries, targets and receptions come from completed-game history. Advanced metrics require a named source and matching player-week coverage."
      >
        {m.evidenceIssue && <p className="notice warning">{m.evidenceIssue}</p>}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
        <div className="toolbar">
          <label className="control">
            <span>Import supplemental evidence CSV</span>
            <input
              aria-label="Import supplemental evidence CSV"
              type="file"
              accept=".csv,text/csv"
              onChange={importCSV}
            />
          </label>
          <button className="subtle" onClick={() => save([])}>
            Clear supplemental evidence
          </button>
        </div>
        <p>
          {m.supplementalInput.rows.length} current evidence rows. Imports
          replace this evidence set. Source files are not retained.
        </p>
        <details>
          <summary>CSV columns and units</summary>
          <p>
            Required: PlayerID, Week, Source, AsOfUTC. UTC timestamps end in Z.
            Usage rows must be completed weeks. Shares use 0–1. Provide the
            complete latest-three-game window for recent metrics.
          </p>
          <p>
            Optional usage columns: PassAttempts, SnapShare, RouteParticipation,
            TargetShare, AirYardsShare, RushInside5, RedZoneTargets, UsageXFP.
            UsageXFP must be scored under this league’s rules. FPOE compares the
            same played games; it is different from a projection gap.
          </p>
          <p>
            Current-week references: ROSOverallRank, TradeValue, MarketFormat.
            Use MarketFormat redraft-1qb-ppr and a comparable redraft, one-QB,
            full-PPR source. External values have provider-specific units and do
            not alter the surplus index.
          </p>
          <p>
            ReturnWeek is an optional availability scenario through the final
            scoring week plus one. It does not certify that a player will
            return.
          </p>
          <pre>
            PlayerID,Week,Source,AsOfUTC,UsageXFP,RouteParticipation,TargetShare,AirYardsShare
          </pre>
        </details>
      </Panel>
      <Panel
        title="Injury return scenarios"
        note="Unknown returns remain conditional. A selected week changes available games, VORP and lineup scenarios; it is not a medical forecast."
      >
        <div className="toolbar">
          <Select label="Injured player" value={player} change={setPlayer}>
            <option value="">Choose player</option>
            {m.players
              .filter((p) => p.uncertain)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.injury}
                </option>
              ))}
          </Select>
          {player && (
            <Select
              label="Return-week scenario"
              value={String(m.byId.get(player)?.opportunity.returnWeek ?? "")}
              change={returnScenario}
            >
              <option value="">Unknown — no assumed return date</option>
              {Array.from(
                { length: m.final - m.current + 2 },
                (_, i) => m.current + i,
              ).map((w) => (
                <option key={w} value={w}>
                  {w > m.final ? "After the fantasy season" : `Week ${w}`}
                </option>
              ))}
            </Select>
          )}
        </div>
        <p>
          With an unknown date, the ordinary scenario allows future
          participation after the current absence. The downside excludes
          uncertain players. Read both before valuing an injured player.
        </p>
      </Panel>
      <Panel
        title="Role forecast calibration"
        note="Exploratory next-game forecasts use previous carries and targets. Every holdout week is predicted using earlier weeks only. Lower mean absolute error is better."
      >
        {/* Forecast scenarios are opt-in and remain visibly conditional throughout trade evaluation. */}
        <div className="toolbar">
          <label className="control">
            <span>Experimental role forecast weight (0–1)</span>
            <input
              aria-label="Experimental role forecast weight (0–1)"
              type="number"
              min="0"
              max="1"
              step="0.05"
              value={roleWeight}
              onChange={(e) => setRoleWeight(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              const value = Number(roleWeight);
              if (
                !roleWeight.trim() ||
                !Number.isFinite(value) ||
                value < 0 ||
                value > 1
              )
                setMessage("Use a role scenario weight from 0 to 1.");
              else {
                change({ [roleScenarioKey]: String(value) });
                setMessage(
                  "Forecast scenario updated; compare values and trades under this assumption.",
                );
              }
            }}
          >
            Apply role scenario
          </button>
        </div>
        <p>
          Zero uses the existing blend. A positive weight mixes that blend with
          the experimental role forecast where available, then recalculates
          consistency, replacements, VORP and trades.{" "}
          {m.roleScenarioWeight > 0
            ? "An experimental scenario is active."
            : "The experimental scenario is off."}
        </p>
        <DataTable
          rows={m.calibration}
          id={(r) => r.position}
          columns={[
            { key: "pos", label: "Position", value: (r) => r.position },
            {
              key: "examples",
              label: "Training examples",
              kind: "fact",
              value: (r) => r.examples,
            },
            {
              key: "tested",
              label: "Held-out predictions",
              kind: "fact",
              value: (r) => r.tested,
            },
            {
              key: "mae",
              label: "Role forecast MAE",
              kind: "model",
              value: (r) => r.mae,
            },
            {
              key: "baseline",
              label: "Season-average MAE",
              kind: "model",
              value: (r) => r.baselineMAE,
            },
            {
              key: "coefficients",
              label: "Fitted intercept / carries / targets",
              kind: "model",
              value: (r) =>
                r.coefficients?.map((x) => fmt(x)).join(" / ") ?? "Unavailable",
            },
            { key: "status", label: "Evidence status", value: (r) => r.status },
          ]}
        />
        <p>
          Role forecasts are displayed alongside the original blend; scenario
          weight is applied once. RB carries and targets receive separately
          fitted coefficients. Current weights and consistency deductions remain
          provisional: archived ESPN forecasts are needed to validate that blend
          without hindsight.
        </p>
        <p>
          Role-growth watch uses three recent games and the configured minimum
          earlier games (default two), a rise of at least two opportunities per
          game and 20%, and the position’s recent-workload threshold. These are
          provisional screening rules.
        </p>
      </Panel>
    </>
  );
}
