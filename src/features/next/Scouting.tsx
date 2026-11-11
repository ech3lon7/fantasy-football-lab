import { useEffect, useMemo, useState } from "react";
import { str } from "../../domain/contracts";
import {
  decodeGemFilters,
  gemClassifications,
  gemQuerySummary,
  gemSignals,
  gemThresholds,
  screenGems,
  validateGemDraft,
  type GemDraft,
  type GemResult,
} from "../../domain/gem-screening";
import {
  activePresetId,
  addSavedSearch,
  facetCounts,
  filtersPatch,
  poolOptions,
  positionOptions,
  readSavedSearches,
  removeSavedSearch,
  savedSearchesKey,
  scoutCards,
  scoutingPresets,
  sortScouting,
} from "../../domain/view/scouting";
import {
  foldedGroupsKey,
  readOpenGroups,
  setGroupOpen,
} from "../../domain/view/primitives";
import type { Model, Player } from "../../domain/valuation";
import {
  DataTable,
  PlayerSignals,
  fmt,
  playerColumnExpected,
  playerColumnIndex,
  playerColumnInjury,
  playerColumnName,
  playerColumnProjected,
  playerColumnRecent,
  playerColumnActual,
  extendedColumns,
  playerColumnTrend,
  playerColumnValue,
  type Column,
} from "../../ui/components";
import { PlayerName } from "../../ui/PlayerName";
import { GemTracking } from "../GemTracking";
import { useVersus } from "./PlayerCard";
import type { GemTrackingState } from "../../domain/gem-tracking";
import {
  Chip,
  FloorCeilingBar,
  FoldingGroup,
  Segmented,
} from "../../ui/primitives";

const views = ["cards", "table"] as const;
const sorts: [string, string][] = [
  ["expected", "Expected PPG"],
  ["recent", "Recent PPG"],
  ["index", "Surplus index"],
  ["trend", "Trend PPG"],
  ["value", "Value PPG"],
  ["name", "Name"],
];
const modes = ["all", "any"] as const;
const modeLabel = { all: "Require all", any: "Any of" };

// One selectable option with the number of players it would show beside it.
function Option({
  label,
  count,
  on,
  change,
}: {
  label: string;
  count: number | null;
  on: boolean;
  change: () => void;
}) {
  return (
    <button type="button" className="gd-opt" aria-pressed={on} onClick={change}>
      {label}
      <small>{count === null ? "" : count}</small>
    </button>
  );
}

// The Scouting explorer: players, gem screener and weekly streamers in one screen with live filters.
export function Scouting({
  m,
  filters,
  onFilters,
  tracking,
}: {
  tracking: Promise<GemTrackingState> | null;
  m: Model;
  filters: Record<string, string>;
  onFilters: (patch: Record<string, string>) => void;
}) {
  const teamIds = m.dataset.tables.ModelTeams.map((t) => str(t.TeamID));
  const defaultTeam = str(
    (
      m.dataset.tables.ModelTeams.find((t) => t.TeamName === "Los Chilones") ??
      m.dataset.tables.ModelTeams[0]
    )?.TeamID,
  );
  const restored = decodeGemFilters(filters, defaultTeam);
  const savedKey = JSON.stringify(restored.draft);
  const versusApi = useVersus();
  const [draft, setDraft] = useState<GemDraft>(restored.draft),
    [limit, setLimit] = useState(48),
    [naming, setNaming] = useState<string | null>(null),
    // On phones the filters open as a bottom sheet; on wider screens they are always visible.
    [sheet, setSheet] = useState(false);
  const applied = validateGemDraft(restored.draft, teamIds),
    appliedIssue = restored.issue || Object.values(applied.errors).join(" "),
    query = appliedIssue ? null : applied.query,
    validation = validateGemDraft(draft, teamIds);

  // Adopt saved filters changed elsewhere (a saved search, another device) without disturbing text still being typed.
  useEffect(() => {
    setDraft((current) => {
      const own = validateGemDraft(current, teamIds).query;
      return own &&
        JSON.stringify(filtersPatch(own)) ===
          JSON.stringify(
            filtersPatch(
              validateGemDraft(restored.draft, teamIds).query ?? own,
            ),
          )
        ? current
        : restored.draft;
    });
    // The saved draft's content is the only trigger.
  }, [savedKey]);

  // Apply every valid edit at once; an invalid field shows its error and leaves the last valid results in place.
  function commit(next: GemDraft) {
    setDraft(next);
    const q = validateGemDraft(next, teamIds).query;
    if (q) onFilters(filtersPatch(q));
  }
  const change = (patch: Partial<GemDraft>) => commit({ ...draft, ...patch });

  const facets = useMemo(
    () => (query ? facetCounts(m.players, query) : null),
    // The saved query and the snapshot are the only inputs.
    [m, savedKey, appliedIssue],
  );
  const results = useMemo(
    () =>
      query ? screenGems(m.players, query) : { matches: [], incomplete: [] },
    [m, savedKey, appliedIssue],
  );
  const nameQuery = (filters.scoutingQuery ?? "").trim().toLowerCase();
  const byName = (rows: GemResult[]) =>
    nameQuery
      ? rows.filter((r) => r.player.name.toLowerCase().includes(nameQuery))
      : rows;
  const view = views.find((v) => v === filters.scoutingView) ?? "cards",
    sortKey = filters.scoutingSort ?? "expected",
    desc = filters.scoutingDirection !== "asc";
  const shown = sortScouting(
    byName([
      ...results.matches,
      ...(query?.includeMissing ? results.incomplete : []),
    ]),
    sortKey,
    desc,
  );
  const open = readOpenGroups(filters[foldedGroupsKey]);
  const saved = readSavedSearches(filters[savedSearchesKey]);
  const preset = query ? activePresetId(query, defaultTeam, teamIds) : null;
  const toggleSignal = (s: string) =>
    change({
      signals: draft.signals.includes(s)
        ? draft.signals.filter((x) => x !== s)
        : [...draft.signals, s],
    });

  // Numeric controls keep the raw text so a half-typed number is never rewritten under the cursor.
  const numeric = (key: (typeof gemThresholds)[number]["key"]) => {
    const f = gemThresholds.find((x) => x.key === key)!,
      error = validation.errors[key];
    return (
      <label className="gd-field" key={key}>
        <span>{f.label}</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={f.label}
          value={draft[key]}
          placeholder="Any"
          aria-invalid={!!error}
          onChange={(e) => change({ [key]: e.target.value })}
        />
        {error && <small className="gd-error">{error}</small>}
      </label>
    );
  };

  const cards = useMemo(
    () => scoutCards(m, shown.slice(0, limit)),
    [m, shown.map((r) => r.player.id).join(","), limit],
  );

  return (
    <div className="gd-scout">
      <div className="gd-scout-saved" role="group" aria-label="Saved searches">
        {scoutingPresets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="gd-opt"
            aria-pressed={preset === p.id}
            onClick={() => {
              const q = validateGemDraft(p.draft(defaultTeam), teamIds).query;
              if (q) {
                setDraft(p.draft(defaultTeam));
                onFilters(filtersPatch(q));
                setLimit(48);
              }
            }}
          >
            {p.label}
          </button>
        ))}
        {saved.map((s) => (
          <span key={s.id} className="gd-saved">
            <button
              type="button"
              className="gd-opt"
              onClick={() => {
                const d = decodeGemFilters(s.filters, defaultTeam).draft;
                const q = validateGemDraft(d, teamIds).query;
                if (q) {
                  setDraft(d);
                  onFilters(filtersPatch(q));
                }
              }}
            >
              {s.name}
            </button>
            <button
              type="button"
              aria-label={`Delete saved search ${s.name}`}
              className="gd-x"
              onClick={() =>
                onFilters({
                  [savedSearchesKey]: removeSavedSearch(
                    filters[savedSearchesKey],
                    s.id,
                  ),
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        {naming === null ? (
          <button
            type="button"
            className="gd-pill"
            disabled={!query}
            onClick={() => setNaming("")}
          >
            Save current as…
          </button>
        ) : (
          <form
            className="gd-saveform"
            onSubmit={(e) => {
              e.preventDefault();
              if (query && naming.trim())
                onFilters({
                  [savedSearchesKey]: addSavedSearch(
                    filters[savedSearchesKey],
                    naming,
                    filtersPatch(query),
                  ),
                });
              setNaming(null);
            }}
          >
            <input
              aria-label="Name for this search"
              value={naming}
              autoFocus
              maxLength={40}
              onChange={(e) => setNaming(e.target.value)}
            />
            <button type="submit" className="gd-pill">
              Save
            </button>
            <button
              type="button"
              className="gd-pill"
              onClick={() => setNaming(null)}
            >
              Cancel
            </button>
          </form>
        )}
      </div>

      <div className="gd-scout-body">
        <aside
          className="gd-filters"
          aria-label="Filters"
          data-sheet={sheet ? "open" : undefined}
        >
          <h2>Filters</h2>
          <section>
            <h3>Player pool</h3>
            <div className="gd-opts">
              {poolOptions.map((pool) => (
                <Option
                  key={pool}
                  label={pool}
                  count={facets?.pool[pool] ?? null}
                  on={draft.pool === pool}
                  change={() => change({ pool })}
                />
              ))}
            </div>
            {draft.pool === "Selected team" && (
              <label className="gd-field">
                <span>Team</span>
                <select
                  aria-label="Team"
                  value={draft.team}
                  onChange={(e) => change({ team: e.target.value })}
                >
                  <option value="">Choose team</option>
                  {m.dataset.tables.ModelTeams.map((t) => (
                    <option key={str(t.TeamID)} value={str(t.TeamID)}>
                      {str(t.TeamName)}
                    </option>
                  ))}
                </select>
                {validation.errors.team && (
                  <small className="gd-error">{validation.errors.team}</small>
                )}
              </label>
            )}
          </section>
          <section>
            <h3>Position</h3>
            <div className="gd-opts">
              {positionOptions.map((position) => (
                <Option
                  key={position}
                  label={position}
                  count={facets?.position[position] ?? null}
                  on={draft.position === position}
                  change={() => change({ position })}
                />
              ))}
            </div>
          </section>
          <section>
            <h3>Signals (badges)</h3>
            <Segmented
              label="Signal matching"
              options={modes}
              value={draft.signalMode ?? "all"}
              format={(v) => modeLabel[v]}
              onChange={(signalMode) => change({ signalMode })}
            />
            <div className="gd-opts">
              {gemSignals.map((s) => (
                <Option
                  key={s}
                  label={s}
                  count={facets?.signals[s] ?? null}
                  on={draft.signals.includes(s)}
                  change={() => toggleSignal(s)}
                />
              ))}
            </div>
            <div className="gd-row">
              <button
                type="button"
                className="gd-pill"
                onClick={() => change({ signals: [...gemSignals] })}
              >
                Select all
              </button>
              <button
                type="button"
                className="gd-pill"
                onClick={() => change({ signals: [] })}
              >
                Clear
              </button>
            </div>
          </section>
          <section>
            <h3>Moving averages</h3>
            <label className="gd-check">
              <input
                type="checkbox"
                checked={draft.goldenCross}
                onChange={(e) => change({ goldenCross: e.target.checked })}
              />
              Golden cross only <small>{facets?.flags.goldenCross ?? ""}</small>
            </label>
            <label className="gd-check">
              <input
                type="checkbox"
                checked={draft.deathCross}
                onChange={(e) => change({ deathCross: e.target.checked })}
              />
              Death cross only <small>{facets?.flags.deathCross ?? ""}</small>
            </label>
            <label className="gd-check">
              <input
                type="checkbox"
                checked={draft.injured}
                onChange={(e) => change({ injured: e.target.checked })}
              />
              Include injured <small>{facets?.flags.injured ?? ""}</small>
            </label>
          </section>
          <section>
            <h3>Thresholds</h3>
            {numeric("trendMin")}
            {numeric("indexMin")}
            {numeric("recentMin")}
          </section>
          <FoldingGroup
            title="Advanced filters"
            summary={
              gemThresholds.filter((f) => f.advanced && draft[f.key]).length +
                Number(draft.aboveReplacement) +
                Number(draft.includeMissing) +
                Number(draft.positiveOnly) +
                Number(draft.indexMax !== "") +
                Number(draft.classification !== "All classifications") ===
              0
                ? "None set"
                : "Some set"
            }
            open={!!open.advanced}
            onToggle={(next) =>
              onFilters({
                [foldedGroupsKey]: setGroupOpen(
                  filters[foldedGroupsKey],
                  "advanced",
                  next,
                ),
              })
            }
          >
            {numeric("indexMax")}
            {gemThresholds.filter((f) => f.advanced).map((f) => numeric(f.key))}
            <label className="gd-field">
              <span>Breakout classification</span>
              <select
                aria-label="Breakout classification"
                value={draft.classification}
                onChange={(e) => change({ classification: e.target.value })}
              >
                {gemClassifications.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="gd-field">
              <span>Regression label</span>
              <select
                aria-label="Regression label"
                value={draft.regression ?? ""}
                onChange={(e) =>
                  change({
                    regression: e.target.value as GemDraft["regression"],
                  })
                }
              >
                <option value="">Any</option>
                <option value="BUY LOW">BUY LOW</option>
                <option value="SELL HIGH">SELL HIGH</option>
                <option value="either">BUY LOW or SELL HIGH</option>
              </select>
            </label>
            {(
              [
                ["aboveReplacement", "Above replacement PPG only"],
                ["includeMissing", "Include players with incomplete evidence"],
                ["positiveOnly", "Positive labels only (no red labels)"],
              ] as const
            ).map(([key, label]) => (
              <label className="gd-check" key={key}>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) => change({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </FoldingGroup>
          <button
            type="button"
            className="gd-cta gd-phone-only gd-sheet-done"
            onClick={() => setSheet(false)}
          >
            Show {shown.length} {shown.length === 1 ? "player" : "players"}
          </button>
        </aside>

        <section className="gd-results" aria-label="Results">
          {appliedIssue ? (
            <div className="gd-banner" role="alert">
              {appliedIssue}{" "}
              <button
                type="button"
                className="gd-pill"
                onClick={() => {
                  const d = scoutingPresets[1].draft(defaultTeam);
                  const q = validateGemDraft(d, teamIds).query;
                  setDraft(d);
                  if (q) onFilters(filtersPatch(q));
                }}
              >
                Reset screener
              </button>
            </div>
          ) : (
            <>
              <header className="gd-results-head">
                <div>
                  <h2 role="status" aria-live="polite">
                    {shown.length} {shown.length === 1 ? "player" : "players"}
                  </h2>
                  <p>{query && gemQuerySummary(query)}</p>
                </div>
                <div className="gd-results-tools">
                  <button
                    type="button"
                    className="gd-pill gd-phone-only"
                    aria-expanded={sheet}
                    onClick={() => setSheet(true)}
                  >
                    Filters
                  </button>
                  <input
                    type="search"
                    aria-label="Search results by name"
                    placeholder="Search results by name"
                    value={filters.scoutingQuery ?? ""}
                    onChange={(e) =>
                      onFilters({ scoutingQuery: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    className="gd-pill"
                    disabled={
                      (filters.versusIds ?? "").split(",").filter(Boolean)
                        .length < 2
                    }
                    onClick={() => versusApi.openVersus()}
                  >
                    Versus
                  </button>
                  {view === "table" && (
                    <label className="gd-check">
                      <input
                        type="checkbox"
                        checked={filters.scoutingAll === "true"}
                        onChange={(e) =>
                          onFilters({ scoutingAll: String(e.target.checked) })
                        }
                      />
                      All evaluation fields
                    </label>
                  )}
                  <Segmented
                    label="View"
                    options={views}
                    value={view}
                    onChange={(v) => onFilters({ scoutingView: v })}
                  />
                  {view === "cards" && (
                    <>
                      <label className="gd-field inline">
                        <span>Sort by</span>
                        <select
                          aria-label="Sort by"
                          value={sortKey}
                          onChange={(e) =>
                            onFilters({ scoutingSort: e.target.value })
                          }
                        >
                          {sorts.map(([k, label]) => (
                            <option key={k} value={k}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="gd-pill"
                        aria-label={
                          desc ? "Sorted high to low" : "Sorted low to high"
                        }
                        onClick={() =>
                          onFilters({
                            scoutingDirection: desc ? "asc" : "desc",
                          })
                        }
                      >
                        {desc ? "High → low" : "Low → high"}
                      </button>
                    </>
                  )}
                </div>
              </header>
              {facets && facets.hidden > 0 && (
                <div className="gd-banner" role="note">
                  {facets.hidden} more player{facets.hidden === 1 ? "" : "s"}{" "}
                  match your other filters but are hidden by the selected
                  signals, classification or player pool.{" "}
                  <button
                    type="button"
                    className="gd-pill"
                    onClick={() =>
                      change({
                        pool: "All",
                        signals: [],
                        classification: "All classifications",
                      })
                    }
                  >
                    Search all players and signals
                  </button>
                </div>
              )}
              {shown.length === 0 && (
                <p className="gd-empty">
                  No players meet every active filter. Remove a filter or pick
                  another saved search.
                </p>
              )}
              {view === "cards" ? (
                <>
                  <div className="gd-cards">
                    {cards.cards.map((c) => {
                      const p = m.byId.get(c.id)!;
                      return (
                        <article
                          key={c.id}
                          className="gd-pcard"
                          data-player-row=""
                        >
                          <header
                            style={{
                              background: c.colors.background,
                              color: c.colors.ink,
                            }}
                          >
                            <PlayerName
                              p={p}
                              className="player-link gd-pcard-name"
                              ariaLabel={`${c.name} ${c.pos} · ${c.nfl}`}
                            >
                              <b>{c.name}</b>
                              <small>
                                {c.pos} · {c.nfl}
                              </small>
                            </PlayerName>
                            <span className="gd-pcard-eppg">
                              <small>EPPG</small>
                              {c.eppg ?? "—"}
                            </span>
                          </header>
                          <div className="gd-pcard-body">
                            <FloorCeilingBar
                              range={c.range}
                              scale={cards.scale}
                              unavailableReason="Next-game range needs a usable EPPG and scoring variability."
                            />
                            <div className="gd-pcard-stats">
                              <span>Recent {c.recent ?? "—"}</span>
                              <span>Surplus {c.surplus ?? "—"}</span>
                            </div>
                            <button
                              type="button"
                              className="gd-pcard-vs"
                              aria-label={`Add ${c.name} to versus`}
                              onClick={() => versusApi.addToVersus(c.id)}
                            >
                              + Versus
                            </button>
                            <div className="gd-pcard-labels">
                              {c.labels.slice(0, 4).map((l) => (
                                <Chip key={l}>{l}</Chip>
                              ))}
                            </div>
                            {c.missing.length > 0 && (
                              <small className="gd-muted">
                                Incomplete: {c.missing.join(" ")}
                              </small>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {shown.length > limit && (
                    <button
                      type="button"
                      className="gd-pill"
                      onClick={() => setLimit(limit + 48)}
                    >
                      Show more ({shown.length - limit} left)
                    </button>
                  )}
                </>
              ) : (
                <ResultsTable
                  all={filters.scoutingAll === "true"}
                  m={m}
                  rows={shown}
                  sortKey={sortKey}
                  desc={desc}
                  onSort={(s) =>
                    onFilters({
                      scoutingSort: s.key,
                      scoutingDirection: s.desc ? "desc" : "asc",
                    })
                  }
                />
              )}
            </>
          )}
        </section>
      </div>
      <FoldingGroup
        title="Prospective Gem tracking"
        summary="Observation journal, stored on this device"
        open={!!open.tracking}
        onToggle={(next) =>
          onFilters({
            [foldedGroupsKey]: setGroupOpen(
              filters[foldedGroupsKey],
              "tracking",
              next,
            ),
          })
        }
      >
        <GemTracking tracking={tracking} />
      </FoldingGroup>
    </div>
  );
}

// Table view: the existing evaluation columns plus the matching evidence and the weekly matchup for streamers.
function ResultsTable({
  m,
  rows,
  sortKey,
  desc,
  onSort,
  all,
}: {
  // Show every evaluation field, including ADP comparisons, instead of the compact set.
  all: boolean;
  m: Model;
  rows: GemResult[];
  sortKey: string;
  desc: boolean;
  onSort: (s: { key: string; desc: boolean }) => void;
}) {
  const signalCol: Column<Player> = {
    key: "priority",
    label: "Signal",
    kind: "model",
    value: (p) => -p.priority,
    render: (p) => <PlayerSignals p={p} />,
  };
  const full: Column<Player>[] = [
    playerColumnName,
    ...extendedColumns.filter((c) => !["name"].includes(c.key)),
  ];
  const base: Column<Player>[] = all
    ? full
    : [
        playerColumnName,
        playerColumnTrend,
        playerColumnExpected,
        playerColumnIndex,
        playerColumnRecent,
        playerColumnProjected,
        playerColumnValue,
        signalCol,
        {
          key: "opponent",
          label: `Week ${m.current} opponent`,
          kind: "fact",
          value: (p) => p.opponent,
        },
        {
          key: "weekly",
          label: `ESPN Week ${m.current}`,
          kind: "projection",
          value: (p) => p.weekly,
        },
        {
          key: "bye",
          label: "Bye week",
          kind: "fact",
          value: (p) => p.bye,
        },
        playerColumnActual,
        playerColumnInjury,
      ];
  const columns: Column<GemResult>[] = [
    ...base.map((c) => ({
      ...c,
      value: (r: GemResult) => c.value(r.player),
      render: c.render ? (r: GemResult) => c.render!(r.player) : undefined,
    })),
    {
      key: "matching",
      label: "Matching evidence",
      value: (r) => [...r.missing, ...r.evidence].join(" - "),
      render: (r) => (
        <span className="gem-evidence">
          {r.missing.length ? "Incomplete: " : "Matches: "}
          {[...r.missing, ...r.evidence]
            .join(" - ")
            .replace(/[+-]?\d+\.\d+/g, (v) => fmt(Number(v)))}
        </span>
      ),
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      id={(r) => r.player.id}
      playerRows
      initialSort="expected"
      sortState={{ key: sortKey, desc }}
      onSort={onSort}
      tieBreaker={(a, b) => +a.player.id - +b.player.id}
    />
  );
}
