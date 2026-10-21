import { useState, type ChangeEvent } from "react";
import type { Model } from "../domain/valuation";
import {
  gemContextKey,
  gemRulesKey,
  gemVersion,
  gemPositions,
  parseGemRules,
  parseRoleReviews,
  roleOutlooks,
  defaultGemRules,
  type RoleReview,
} from "../domain/gems";
import { Panel, Select } from "../ui/layout";

// Keep role reviews separate from numeric usage/market evidence so their sources cannot overwrite each other.
export function GemSettings({
  m,
  filters,
  change,
}: {
  m: Model;
  filters: Record<string, string>;
  change: (patch: Record<string, string>) => void;
}) {
  const [player, setPlayer] = useState("");
  const [rules, setRules] = useState(JSON.stringify(m.gemRules, null, 2));
  const [message, setMessage] = useState("");
  const existing = m.roleReviews.find((r) => r.PlayerID === player);
  // Bound the combined settings payload before saving through existing account-scoped sync.
  function persist(patch: Record<string, string>) {
    if (
      new TextEncoder().encode(JSON.stringify({ ...filters, ...patch }))
        .length > 52000
    )
      throw Error(
        "Settings exceed sync space; use fewer supplemental rows or reviews.",
      );
    change(patch);
  }
  // Validate the complete collection atomically; imports replace reviews only after every row passes.
  function saveReviews(rows: Record<string, unknown>[]) {
    try {
      const parsed = parseRoleReviews(rows, m.dataset);
      persist({
        [gemContextKey]: JSON.stringify({
          version: gemVersion,
          datasetHash: m.dataset.hash,
          rows: parsed,
        }),
      });
      setMessage(`Saved ${parsed.length} sourced role reviews.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  // Read only a bounded CSV in memory; the original source file is never retained.
  async function importReviews(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      if (file.size > 50000)
        throw Error("Use a role review CSV smaller than 50 KB.");
      const XLSX = await import("xlsx");
      const book = XLSX.read(await file.text(), {
        type: "string",
        raw: true,
        cellFormula: false,
      });
      saveReviews(
        XLSX.utils.sheet_to_json<Record<string, unknown>>(
          book.Sheets[book.SheetNames[0]],
          { raw: true, defval: null },
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <Panel
      title="Gem rules and role reviews"
      note="Gem requires sustained starter-level workload, meaningful growth and a sourced ongoing role. Forecast outperformance alone never qualifies. These rules do not change valuation or trade results."
    >
      {m.gemIssue && (
        <p className="notice warning" role="alert">
          {m.gemIssue}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <p>
        {m.roleReviews.length} current role reviews. Unknown, temporary or stale
        context caps a promising player at Watch. Review again after each
        import. No automatic news feed is assumed.
      </p>
      <Select label="Role review player" value={player} change={setPlayer}>
        <option value="">Choose player</option>
        {m.players
          .filter((p) =>
            gemPositions.includes(p.pos as (typeof gemPositions)[number]),
          )
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.pos}
            </option>
          ))}
      </Select>
      {player && (
        <RoleReviewForm
          key={`${m.dataset.hash}/${player}/${JSON.stringify(existing)}`}
          m={m}
          player={player}
          existing={existing}
          save={(row) =>
            saveReviews([
              ...m.roleReviews
                .filter((r) => r.PlayerID !== player)
                .map((r) => ({ ...r })),
              { ...row },
            ])
          }
        />
      )}
      <div className="toolbar">
        <label className="control">
          <span>Import role reviews CSV</span>
          <input
            aria-label="Import role reviews CSV"
            type="file"
            accept=".csv,text/csv"
            onChange={importReviews}
          />
        </label>
        <button className="subtle" onClick={() => saveReviews([])}>
          Clear role reviews
        </button>
      </div>
      <details>
        <summary>Review sources and CSV format</summary>
        <p>
          Columns: PlayerID, Week, ThroughWeek, Outlook, Source, AsOfUTC,
          Reason. Week is the current scoring week. ThroughWeek explicitly
          confirms the latest played week covered by your review. Use an outlook
          exactly as listed, a named source or URL, its UTC timestamp ending in
          Z, and why the role can persist. A personal review is an assumption; a
          source field alone does not verify a claim. Reviews expire after{" "}
          {m.gemRules.contextDays} days; snapshots older than 24 hours require
          refresh.
        </p>
        <p>
          Outlooks: {roleOutlooks.join("; ")}. Imports replace the role review
          collection. No usage or market evidence is replaced.
        </p>
      </details>
      {/* Editable JSON exposes every small rule parameter without extending the strict workbook settings contract. */}
      <details>
        <summary>Adjust provisional Gem thresholds</summary>
        <p>
          RB uses carries + targets; WR/TE use targets. Each position has a
          last-three mean, EACH-game floor, and minimum absolute growth. Growth
          also must meet growthPct (0–1), except when the previous workload is
          zero. Five verified games and the 3-versus-2/3 windows remain
          mandatory. contextDays is 1–7.
        </p>
        <label className="control">
          <span>Gem rule configuration (JSON)</span>
          <textarea
            aria-label="Gem rule configuration (JSON)"
            rows={14}
            style={{ width: "100%", maxWidth: "100%" }}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
        </label>
        <div className="toolbar">
          <button
            onClick={() => {
              try {
                persist({
                  [gemRulesKey]: JSON.stringify(parseGemRules(rules)),
                });
              } catch (error) {
                setMessage(
                  error instanceof Error ? error.message : String(error),
                );
              }
            }}
          >
            Apply Gem rules
          </button>
          <button
            className="subtle"
            onClick={() => setRules(JSON.stringify(defaultGemRules, null, 2))}
          >
            Load provisional defaults
          </button>
        </div>
      </details>
    </Panel>
  );
}

// Capture an explicit source/date and covered scoring week rather than inventing why opportunity changed.
function RoleReviewForm({
  m,
  player,
  existing,
  save,
}: {
  m: Model;
  player: string;
  existing?: RoleReview;
  save: (row: RoleReview) => void;
}) {
  const [outlook, setOutlook] = useState<RoleReview["Outlook"]>(
    existing?.Outlook ?? "Unclear",
  );
  const [source, setSource] = useState(existing?.Source ?? "");
  const [date, setDate] = useState(existing?.AsOfUTC ?? "");
  const [reason, setReason] = useState(existing?.Reason ?? "");
  const [through, setThrough] = useState(
    String(existing?.ThroughWeek ?? m.current - 1),
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save({
          PlayerID: player,
          Week: m.current,
          ThroughWeek: Number(through),
          Outlook: outlook,
          Source: source,
          AsOfUTC: date,
          Reason: reason,
        });
      }}
    >
      <div className="toolbar">
        <Select
          label="Role outlook"
          value={outlook}
          change={(v) => setOutlook(v as RoleReview["Outlook"])}
        >
          {roleOutlooks.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </Select>
        <label className="control">
          <span>Review source or URL</span>
          <input
            required
            maxLength={120}
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </label>
        <label className="control">
          <span>Source timestamp (UTC)</span>
          <input
            required
            placeholder="YYYY-MM-DDTHH:mm:ssZ"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="control">
          <span>Reviewed through week</span>
          <input
            required
            type="number"
            min={1}
            max={m.current - 1}
            value={through}
            onChange={(e) => setThrough(e.target.value)}
          />
        </label>
      </div>
      <label className="control">
        <span>Why the role can continue / context</span>
        <textarea
          required
          maxLength={600}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button type="submit">Save role review</button>
    </form>
  );
}
