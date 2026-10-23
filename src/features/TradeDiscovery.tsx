import type { Draft } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import type { OpponentIncentive } from "../domain/trade-discovery";
import { FilterHelp } from "../ui/FilterHelp";
import { signed } from "../ui/components";

// Keep exploratory controls local until an evaluated package is explicitly loaded or saved.
export interface DiscoveryState {
  flexible: boolean;
  pool: string[];
  minimum: string;
  maximum: string;
  target: string;
  targetSearch: string;
  ranking: "own" | "other" | "balanced";
  nearMisses: boolean;
}
export const initialDiscovery: DiscoveryState = {
  flexible: false,
  pool: [],
  minimum: "1",
  maximum: "3",
  target: "",
  targetSearch: "",
  ranking: "own",
  nearMisses: false,
};

// Reuse existing labeled controls and invisible hover help rather than introduce another control style.
export function TradeDiscoveryControls({
  m,
  draft,
  value,
  change,
  starters,
  startersKnown,
}: {
  m: Model;
  draft: Draft;
  value: DiscoveryState;
  change: (value: DiscoveryState) => void;
  starters: string[];
  startersKnown: boolean;
}) {
  const owned = m.players
    .filter((p) => p.owner === draft.teamA)
    .sort((a, b) => a.name.localeCompare(b.name));
  const targets = m.players
    .filter(
      (p) =>
        p.owner !== "0" &&
        p.owner !== draft.teamA &&
        (p.id === value.target ||
          p.name.toLowerCase().includes(value.targetSearch.toLowerCase())),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <fieldset className="trade-search-group">
      <legend>Search approach</legend>
      <div className="trade-search-controls">
        <FilterHelp
          label="Find outgoing combinations"
          help="Select up to 12 tradable players, then choose how many to offer (1–5). Every unselected player is protected from offers and automatic drops. The worker checks every eligible combination; larger searches may take longer and can be cancelled."
        >
          <label className="check">
            <input
              type="checkbox"
              checked={value.flexible}
              onChange={(e) =>
                change({
                  ...value,
                  flexible: e.target.checked,
                  pool: value.pool.length ? value.pool : [...draft.give],
                })
              }
            />
            Find outgoing combinations
          </label>
        </FilterHelp>
        <FilterHelp
          label="Rank trades by"
          help="Your gain uses your marked-starter impact. Their gain uses their optimized full-roster potential with the same rules before and after the trade. Benefit to both puts legal trades with positive gains on both measures first, then maximizes the smaller gain. Value, depth and uncertainty remain separate."
        >
          <label className="control">
            <span>Rank trades by</span>
            <select
              value={value.ranking}
              onChange={(e) =>
                change({
                  ...value,
                  ranking: e.target.value as DiscoveryState["ranking"],
                })
              }
            >
              <option value="own">Your weekly gain</option>
              <option value="other">Their weekly gain</option>
              <option value="balanced">Benefit to both teams</option>
            </select>
          </label>
        </FilterHelp>
        <FilterHelp
          label="Show near misses and adjustments"
          help="Separately show up to five evaluated alternatives. Search one fewer/more incoming player and up to five additional index points outside each bound. Each unmet limit is explained; these are not exact matches or guarantees. Protected players, target selection, ownership and roster legality are never relaxed."
        >
          <label className="check">
            <input
              type="checkbox"
              checked={value.nearMisses}
              onChange={(e) =>
                change({ ...value, nearMisses: e.target.checked })
              }
            />
            Show near misses and adjustments
          </label>
        </FilterHelp>
      </div>
      {value.flexible && (
        <>
          <div className="trade-search-controls">
            {(
              [
                ["Minimum outgoing players", "minimum"],
                ["Maximum outgoing players", "maximum"],
              ] as const
            ).map(([label, field]) => (
              <FilterHelp
                key={field}
                label={label}
                help="Inclusive number of players to choose from your tradable pool, from one through five. Players outside the pool are never offered."
              >
                <label className="control">
                  <span>{label}</span>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    step="1"
                    value={value[field]}
                    onChange={(e) =>
                      change({ ...value, [field]: e.target.value })
                    }
                  />
                </label>
              </FilterHelp>
            ))}
            <button
              type="button"
              className="subtle"
              disabled={!startersKnown}
              onClick={() =>
                change({
                  ...value,
                  pool: value.pool.filter((id) => !starters.includes(id)),
                })
              }
            >
              Protect my starters
            </button>
          </div>
          <details>
            <summary>
              Tradable pool ({value.pool.length} selected; everyone else
              protected)
            </summary>
            <div className="trade-search-controls">
              {owned.map((p) => (
                <label className="check" key={p.id}>
                  <input
                    type="checkbox"
                    aria-label={`Tradable ${p.name}`}
                    checked={value.pool.includes(p.id)}
                    onChange={(e) =>
                      change({
                        ...value,
                        pool: e.target.checked
                          ? [...value.pool, p.id]
                          : value.pool.filter((id) => id !== p.id),
                      })
                    }
                  />
                  {p.name} · {p.pos}{" "}
                  <small className="muted">
                    {value.pool.includes(p.id) ? "Tradable" : "Protected"}
                  </small>
                </label>
              ))}
            </div>
          </details>
        </>
      )}
      {/* Targeting one rostered player narrows the counterparty while retaining all ordinary incoming filters. */}
      <div className="trade-search-controls">
        <FilterHelp
          label="Find a target player"
          help="Search rostered players on other teams, then choose a specific target. Position and Gem/Watch filters still apply to the incoming package."
        >
          <label className="control">
            <span>Find a target player</span>
            <input
              value={value.targetSearch}
              onChange={(e) =>
                change({ ...value, targetSearch: e.target.value })
              }
            />
          </label>
        </FilterHelp>
        <FilterHelp
          label="Required incoming player"
          help="Every result must include this player from their current fantasy team. Any player removes only this restriction; your other incoming filters still apply."
        >
          <label className="control">
            <span>Required incoming player</span>
            <select
              value={value.target}
              onChange={(e) => change({ ...value, target: e.target.value })}
            >
              <option value="">Any player</option>
              {targets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.pos}
                </option>
              ))}
            </select>
          </label>
        </FilterHelp>
      </div>
    </fieldset>
  );
}

// Evidence is explanatory, not an acceptance score; show positional gains and losses alongside the package's existing warnings.
export function OpponentIncentiveView({
  value,
}: {
  value?: OpponentIncentive;
}) {
  if (!value) return null;
  return (
    <details>
      <summary>Why the other team might accept</summary>
      <p>
        {value.summary}. This is supporting evidence, not an acceptance
        probability.
      </p>
      {value.notes.map((note, i) => (
        <p key={i} className={i < 2 ? "model" : undefined}>
          {note}
        </p>
      ))}
      {value.positions.map((position) => (
        <p key={position.position}>
          {position.position} · Before grade:{" "}
          <span className="model">{position.grade}</span> · Modeled starter
          change: <span className="model">{signed(position.starterGain)}</span>{" "}
          Expected PPG · Best-backup change:{" "}
          <span className="model">
            {position.backupGain === null
              ? "Unavailable"
              : signed(position.backupGain)}
          </span>{" "}
          Expected PPG.
        </p>
      ))}
    </details>
  );
}
