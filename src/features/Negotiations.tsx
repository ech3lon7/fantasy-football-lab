import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readNegotiations,
  putNegotiations,
  syncNegotiations,
  resolveNegotiation,
  type NegotiationConflict,
} from "../storage/negotiations";
import {
  journalImportSchema,
  linkedJournalOffer,
  sameJournalEntry,
  newJournalOffer,
  freezeAssessment,
  journalCalibration,
  profileSuggestion,
  type JournalEntry,
} from "../domain/trade-journal";
import {
  managerAssessment,
  managerSettingsSchema,
  managerPresetNames,
  acceptanceLabels,
  type ManagerAssessment,
  type ManagerProfile,
  type ManagerSettings,
} from "../domain/manager-expectations";
import { tradeImpact, type LineupBasis } from "../domain/trade-impact";
import { evaluateTrade, type TradeResult } from "../domain/trades";
import { str, type Draft } from "../domain/contracts";
import type { Model } from "../domain/valuation";
import { PlayerName } from "../ui/PlayerName";
import { FilterHelp } from "../ui/FilterHelp";
import { fmt, signed } from "../ui/components";
import { Panel } from "../ui/layout";

// Share only account data/profiles; direct analysis, standard search and each chain stage own their editable settings.
interface JournalContext {
  entries: JournalEntry[];
  profiles: Record<string, ManagerProfile>;
  ready: boolean;
  status: string;
  conflicts: NegotiationConflict[];
  put: (entries: JournalEntry[]) => Promise<void>;
  sync: () => Promise<void>;
  resolve: (conflict: NegotiationConflict, local: boolean) => Promise<void>;
}
const Journal = createContext<JournalContext>({
  entries: [],
  profiles: {},
  ready: false,
  status: "",
  conflicts: [],
  put: async () => {
    throw Error("Open a workspace before saving journal records.");
  },
  sync: async () => {},
  resolve: async () => {},
});
export const useNegotiations = () => useContext(Journal);

// Account-keyed loading and serialized sync prevent a prior account's records from appearing after sign-out.
export function NegotiationsProvider({
  owner,
  client,
  children,
}: {
  owner: string;
  client: SupabaseClient | null;
  children: ReactNode;
}) {
  const [entries, setEntries] = useState<JournalEntry[]>([]),
    [ready, setReady] = useState(false),
    [status, setStatus] = useState(""),
    [conflicts, setConflicts] = useState<NegotiationConflict[]>([]);
  const alive = useRef(true),
    busy = useRef(false),
    generation = useRef(0);
  const refresh = async () => {
    const current = ++generation.current;
    const rows = await readNegotiations(owner);
    if (alive.current && current === generation.current) {
      setEntries(rows.map((r) => r.entry));
      setReady(true);
    }
  };
  const put = async (rows: JournalEntry[]) => {
    await putNegotiations(owner, rows);
    await refresh();
    if (alive.current)
      setStatus(
        "Saved on this device; sync to copy it privately to your account.",
      );
  };
  const sync = async () => {
    if (!client || owner === "local" || busy.current) return;
    busy.current = true;
    try {
      const found = await syncNegotiations(owner, client);
      if (!alive.current) return;
      setConflicts(found);
      setStatus(
        found.length
          ? `${found.length} journal record conflict(s); choose below. Local data is preserved.`
          : "Trade journal synced privately.",
      );
      window.dispatchEvent(
        new CustomEvent("fantasy-journal-sync-status", {
          detail: {
            owner,
            issue: found.length
              ? "Journal record conflict — open Trade journal"
              : "",
          },
        }),
      );
      await refresh();
    } catch (e) {
      if (alive.current)
        setStatus(
          e instanceof Error
            ? e.message
            : "Trade journal sync failed; local records remain saved.",
        );
      window.dispatchEvent(
        new CustomEvent("fantasy-journal-sync-status", {
          detail: {
            owner,
            issue: "Journal sync needs attention — open Trade journal",
          },
        }),
      );
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    alive.current = true;
    void refresh().catch((e) => {
      if (alive.current)
        setStatus(
          `Could not open the journal: ${e.message}. Existing records were preserved.`,
        );
    });
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail === owner)
        void refresh().catch((e) => setStatus(e.message));
    };
    const requested = () => {
      void sync();
    };
    window.addEventListener("fantasy-negotiations-changed", changed);
    window.addEventListener("fantasy-sync-negotiations", requested);
    return () => {
      alive.current = false;
      window.removeEventListener("fantasy-negotiations-changed", changed);
      window.removeEventListener("fantasy-sync-negotiations", requested);
    };
  }, [owner, client]);
  const profiles = Object.fromEntries(
    entries.flatMap((e) =>
      e.kind === "profile"
        ? [
            [
              e.payload.team,
              {
                preset: e.payload.preset,
                cornerstones: e.payload.cornerstones,
              },
            ],
          ]
        : [],
    ),
  );
  return (
    <Journal.Provider
      value={{
        entries,
        profiles,
        ready,
        status,
        conflicts,
        put,
        sync,
        resolve: async (conflict, local) => {
          await resolveNegotiation(owner, conflict, local);
          setConflicts((old) =>
            old.filter((c) => c.local.entry.id !== conflict.local.entry.id),
          );
          await sync();
        },
      }}
    >
      {children}
    </Journal.Provider>
  );
}

// Opt-in controls have no effect on any private player metric, other tool's settings.
export function ManagerControls({
  value,
  change,
  label = "Enable Surface Trading",
}: {
  value?: ManagerSettings;
  change: (next?: ManagerSettings) => void;
  label?: string;
}) {
  const journal = useNegotiations();
  return (
    <fieldset className="trade-search-group">
      <legend>Surface Trading</legend>
      <FilterHelp
        label={label}
        help="Use actual season averages, elite-return safeguards and the recipient's saved preset. Overall surface scoring gain is a preference, not a mandatory minimum. Estimated acceptance is provisional. Other enabled filters still apply."
      >
        <label className="check">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) =>
              change(
                e.target.checked
                  ? { version: 1, profiles: journal.profiles }
                  : undefined,
              )
            }
          />
          {label}
        </label>
      </FilterHelp>
      {value && (
        <label className="control">
          <span>Recipient preset</span>
          <select
            value={value.override ?? "saved"}
            onChange={(e) =>
              change({
                ...value,
                profiles: journal.profiles,
                override:
                  e.target.value === "saved"
                    ? undefined
                    : Number(e.target.value),
              })
            }
          >
            <option value="saved">Use each manager's saved preset</option>
            {managerPresetNames.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
    </fieldset>
  );
}

// Render a compact estimate and an auditable required-versus-actual comparison without mixing surface PPG with private EPPG.
export function ManagerEvidence({
  value,
  m,
  draft,
  allowLog = true,
  basis = "best-available",
  lineupsRaw,
}: {
  value: ManagerAssessment;
  m: Model;
  draft: Draft;
  allowLog?: boolean;
  basis?: LineupBasis;
  lineupsRaw?: string;
}) {
  const journal = useNegotiations(),
    [message, setMessage] = useState("");
  const name = (id: string | null) =>
    id ? (
      m.byId.has(id) ? (
        <PlayerName p={m.byId.get(id)!} />
      ) : (
        id
      )
    ) : (
      "Vacant role"
    );
  const log = async () => {
    try {
      const recordedUTC = new Date().toISOString(),
        offerId = crypto.randomUUID(),
        offer = newJournalOffer(m, draft, draft.teamA, recordedUTC),
        trade = evaluateTrade(m, draft, false, lineupsRaw);
      if (!trade.valid) throw Error(trade.errors.join(" "));
      const impact = tradeImpact(trade, basis)!;
      await journal.put([
        { id: offerId, kind: "offer", payload: offer },
        {
          id: crypto.randomUUID(),
          kind: "forecast",
          payload: {
            offer: offerId,
            recordedUTC,
            assessment: freezeAssessment(value),
            draft,
            origin: "prospective",
            context: JSON.stringify({
              dataset: m.dataset.hash,
              analysis: m.analysisVersion,
              scenario: m.simulation?.scenario?.id ?? null,
            }),
            privateImpact: {
              basis,
              ownBefore: impact.own.beforePerWeek,
              ownAfter: impact.own.afterPerWeek,
              ownGain: impact.own.expectedPerWeek,
              otherBefore: impact.other.beforePerWeek,
              otherAfter: impact.other.afterPerWeek,
              otherGain: impact.other.expectedPerWeek,
            },
            settings: JSON.stringify({
              settings: m.settings,
              basis,
              lineupsRaw,
              scenario: m.simulation
                ? {
                    id: m.simulation.scenario.id,
                    moves: m.simulation.scenario.moves,
                    sourceHash: m.simulation.scenario.sourceHash,
                  }
                : null,
              availability: {
                ignoreByeWeeks: !!m.ignoreByeWeeks,
                ignoreTemporaryAbsences: !!m.ignoreTemporaryAbsences,
              },
            }),
            names: Object.fromEntries(
              [
                ...new Set([
                  ...draft.give,
                  ...draft.get,
                  ...trade.initialB,
                  ...trade.legalB,
                ]),
              ].map((id) => [id, m.byId.get(id)?.name ?? id]),
            ),
            rosters: {
              before: trade.initialB,
              after: trade.legalB,
              drops: trade.dropsB,
            },
          },
        },
      ]);
      setMessage(
        "Offer and original forecast logged as pending. Record the real response in Trade journal.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not log this offer.");
    }
  };
  return (
    <section aria-label="Manager expectations assessment">
      <p className="model">
        <strong>
          {value.range
            ? `${acceptanceLabels[value.band! + 2]} · approximately ${value.range[0]}–${value.range[1]}% estimated acceptance`
            : value.status === "safeguard-failed"
              ? "Does not meet manager safeguards"
              : value.status === "conditional"
                ? "Conditional availability — no unconditional estimate"
                : "Manager assessment unavailable"}
        </strong>
        <small>{managerPresetNames[value.preset]} · Provisional estimate</small>
      </p>
      {value.reasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      <details>
        <summary>Why this estimate?</summary>
        <p>
          Source: {value.sourceUTC ?? "Unknown refresh time"} · Week{" "}
          {value.week}. Season-average best lineups; independent of your private
          scoring selector.
        </p>
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Required / explanation</th>
              <th>Actual evidence</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Surface scoring</td>
              <td className="editable">
                Preferred net gain {signed(value.preferred)} PPG; soft
                preference
              </td>
              <td className="fact">
                {fmt(value.average?.before ?? null)} →{" "}
                {fmt(value.average?.after ?? null)};{" "}
                {signed(value.average?.gain ?? null)}
              </td>
            </tr>
            {value.matches.map((match) => (
              <tr key={match.outgoing}>
                <td>
                  {name(match.outgoing)} → {name(match.incoming)}
                  <small>{match.tier}</small>
                </td>
                <td className="editable">
                  {match.samePosition
                    ? `Main ≥ ${fmt(match.required)} actual PPG`
                    : `Main positional rank ≤ ${match.required}`}
                </td>
                <td className="fact">
                  {match.samePosition ? fmt(match.actual) : `#${match.actual}`}{" "}
                  ·{" "}
                  <span className="model">
                    {match.stronger
                      ? "Stronger main under rank/PPG rule"
                      : match.compensation
                        ? "Compensation verified"
                        : "No additional compensation required"}
                  </span>
                  {match.compensation && (
                    <small>
                      {name(match.compensation.incoming)} vs{" "}
                      {name(match.compensation.incumbent)}:{" "}
                      {signed(match.compensation.gain)} PPG; required +
                      {fmt(match.compensation.required)}
                    </small>
                  )}
                </td>
              </tr>
            ))}
            {value.status === "safeguard-failed" &&
              value.checks?.map((check) => (
                <tr key={`${check.outgoing}/${check.incoming}`}>
                  <td>
                    {name(check.outgoing)} → {name(check.incoming)}
                  </td>
                  <td className="editable">
                    {check.samePosition
                      ? `Main ≥ ${fmt(check.required)} actual PPG`
                      : `Main positional rank ≤ ${check.required}`}
                    <small>
                      If not stronger, distinct starter compensation ≥{" "}
                      {fmt(check.compensation)} PPG.
                    </small>
                  </td>
                  <td>
                    <span className="fact">
                      {check.actual === null
                        ? "Unavailable"
                        : check.samePosition
                          ? fmt(check.actual)
                          : `#${check.actual}`}
                    </span>{" "}
                    ·{" "}
                    <span className="model">
                      {check.qualifies
                        ? "Main quality PASS; distinct matching/compensation still required"
                        : "Main quality FAIL"}
                    </span>
                  </td>
                </tr>
              ))}
            <tr>
              <td>Range contributions</td>
              <td>Net band + main comfort − weekly caution</td>
              <td className="model">
                {value.baseBand ?? "—"} + {value.comfort ?? "—"} −{" "}
                {value.caution ?? "—"}; margin {signed(value.margin ?? null)}
              </td>
            </tr>
            <tr>
              <td>ESPN weekly projection</td>
              <td>Optional caution; verified normal availability only</td>
              <td className="projection">
                {fmt(value.projection?.before ?? null)} →{" "}
                {fmt(value.projection?.after ?? null)};{" "}
                {signed(value.projection?.gain ?? null)}
              </td>
            </tr>
          </tbody>
        </table>
        {value.population && (
          <p>
            Rank coverage: {value.population.completeActual} complete offensive
            actual histories; {value.population.positionalSample} meet the
            three-game positional sample, from {value.population.imported}{" "}
            imported players.
          </p>
        )}
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Before</th>
              <th>After</th>
              <th>Actual-average difference</th>
            </tr>
          </thead>
          <tbody>
            {value.average?.slots.map((slot, i) => {
              const before = value.average!.beforeIds[i],
                after = value.average!.afterIds[i];
              return before === after ? null : (
                <tr key={`${slot}-${i}`}>
                  <td>{slot}</td>
                  <td>
                    {name(before)}{" "}
                    <span className="fact">
                      {fmt(before ? (m.byId.get(before)?.actual ?? null) : 0)}
                    </span>
                  </td>
                  <td>
                    {name(after)}{" "}
                    <span className="fact">
                      {fmt(after ? (m.byId.get(after)?.actual ?? null) : 0)}
                    </span>
                  </td>
                  <td className="fact">
                    {signed(
                      (after ? (m.byId.get(after)?.actual ?? 0) : 0) -
                        (before ? (m.byId.get(before)?.actual ?? 0) : 0),
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {value.warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
        <small>
          Rules {value.version}. Ranges are operating assumptions, not
          established predictive accuracy.
        </small>
      </details>
      {allowLog && (
        <button className="button" onClick={() => void log()}>
          Log offer + original forecast
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}

// Direct analysis reuses the same pure evaluator as search and saves only its own optional control state.
export function DirectManagerAssessment({
  m,
  draft,
  result,
  raw,
  change,
  basis,
  lineupsRaw,
}: {
  m: Model;
  draft: Draft;
  result: TradeResult | null;
  raw?: string;
  change: (raw: string) => void;
  basis?: LineupBasis;
  lineupsRaw?: string;
}) {
  const journal = useNegotiations();
  let settings: ManagerSettings | undefined;
  try {
    settings = raw ? managerSettingsSchema.parse(JSON.parse(raw)) : undefined;
  } catch {
    settings = undefined;
  }
  const effective = settings
    ? { ...settings, profiles: journal.profiles }
    : undefined;
  const assessment =
    effective && result && journal.ready
      ? managerAssessment(m, draft, result, effective)
      : undefined;
  return (
    <>
      <ManagerControls
        value={effective}
        change={(next) => change(next ? JSON.stringify(next) : "")}
      />
      {assessment && (
        <ManagerEvidence
          value={assessment}
          m={m}
          draft={draft}
          basis={basis}
          lineupsRaw={lineupsRaw}
        />
      )}
    </>
  );
}

// Journal/profile editing is explicit; imports are previewed, and no search or practice exchange writes real outcomes automatically.
export function TradeJournal({ m, ownTeam }: { m: Model; ownTeam: string }) {
  const journal = useNegotiations(),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<JournalEntry[] | null>(null),
    [team, setTeam] = useState(ownTeam),
    [other, setOther] = useState(
      m.dataset.tables.ModelTeams.map((t) => str(t.TeamID)).find(
        (id) => id !== ownTeam,
      ) ?? "",
    ),
    [give, setGive] = useState<string[]>([]),
    [get, setGet] = useState<string[]>([]),
    [parent, setParent] = useState<Extract<
      JournalEntry,
      { kind: "offer" }
    > | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const attempt = async (action: () => Promise<void>) => {
    try {
      await action();
      setMessage("Saved.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save.");
    }
  };
  const names = (
    ids: string[],
    entry?: Extract<JournalEntry, { kind: "offer" }>,
  ) =>
    ids
      .map((id) => entry?.payload.names[id] ?? m.byId.get(id)?.name ?? id)
      .join(" + ");
  const importFile = async (selected: File) => {
    try {
      if (selected.size > 25 * 1024 * 1024)
        throw Error("Journal import exceeds 25 MiB.");
      const value = selected.name.toLowerCase().endsWith(".xlsx")
        ? await (
            await import("../import/trade-journal")
          ).importJournalWorkbook(
            new Uint8Array(await selected.arrayBuffer()),
            ownTeam,
          )
        : JSON.parse(await selected.text());
      setPreview(journalImportSchema.parse(value).entries);
      setMessage("");
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Journal import failed; saved records are intact.",
      );
    }
  };
  const offers = journal.entries.filter(
    (e): e is Extract<JournalEntry, { kind: "offer" }> => e.kind === "offer",
  );
  return (
    <>
      <Panel
        title="Trade journal"
        note="Private records, counteroffers and original forecasts. Pending is not a rejection."
      >
        <div className="toolbar">
          <button className="button" onClick={() => file.current?.click()}>
            Import documented trades
          </button>
          <button
            className="button"
            onClick={() => {
              const url = URL.createObjectURL(
                  new Blob(
                    [
                      JSON.stringify(
                        { version: 1, entries: journal.entries },
                        null,
                        2,
                      ),
                    ],
                    { type: "application/json" },
                  ),
                ),
                a = document.createElement("a");
              a.href = url;
              a.download = "fantasy-trade-journal.json";
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 0);
            }}
          >
            Export journal
          </button>
          <button className="button" onClick={() => void journal.sync()}>
            Sync journal now
          </button>
        </div>
        <input
          hidden
          ref={file}
          type="file"
          accept=".json,.xlsx"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            if (selected) void importFile(selected);
            e.target.value = "";
          }}
        />
        {preview && (
          <div className="notice">
            <p>
              Import {preview.length} records. Identical IDs are skipped;
              conflicting IDs are preserved for review.
            </p>
            <ul>
              {preview.slice(0, 5).map((e) => (
                <li key={e.id}>
                  {e.kind} · {e.id}
                </li>
              ))}
            </ul>
            <button
              className="button"
              onClick={() =>
                void attempt(async () => {
                  const conflicts = preview.filter((e) =>
                    journal.entries.some(
                      (old) => old.id === e.id && !sameJournalEntry(old, e),
                    ),
                  );
                  if (conflicts.length)
                    throw Error(
                      `Conflicting IDs: ${conflicts.map((e) => e.id).join(", ")}. Export/reconcile before importing; no records were changed.`,
                    );
                  await journal.put(preview);
                  setPreview(null);
                })
              }
            >
              Confirm import
            </button>
            <button onClick={() => setPreview(null)}>Cancel</button>
          </div>
        )}
        <p role="status">{message || journal.status}</p>
        {journal.conflicts.map((conflict) => (
          <div className="notice warning" key={conflict.local.entry.id}>
            <p>
              Conflict: {conflict.local.entry.id}. Export the journal to retain
              a separate copy before deciding.
            </p>
            <button
              className="button"
              onClick={() =>
                void attempt(() => journal.resolve(conflict, true))
              }
            >
              {conflict.local.entry.kind === "forecast"
                ? "Keep both immutable forecasts"
                : "Keep this device's record"}
            </button>
            <button
              className="button"
              onClick={() =>
                void attempt(() => journal.resolve(conflict, false))
              }
            >
              Use cloud record
            </button>
          </div>
        ))}
        <details>
          <summary>
            {parent ? "Create linked counteroffer" : "Record another offer"}
          </summary>
          <div className="two-col">
            {(["give", "get"] as const).map((side) => (
              <div key={side}>
                <label className="control">
                  <span>{side === "give" ? "Proposer" : "Recipient"}</span>
                  <select
                    value={side === "give" ? team : other}
                    onChange={(e) => {
                      if (side === "give") {
                        setTeam(e.target.value);
                        setGive([]);
                      } else {
                        setOther(e.target.value);
                        setGet([]);
                      }
                    }}
                  >
                    {m.dataset.tables.ModelTeams.map((t) => (
                      <option key={str(t.TeamID)} value={str(t.TeamID)}>
                        {str(t.TeamName)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control">
                  <span>
                    {side === "give" ? "Offered players" : "Requested players"}
                  </span>
                  <select
                    multiple
                    value={side === "give" ? give : get}
                    onChange={(e) =>
                      (side === "give" ? setGive : setGet)(
                        Array.from(e.target.selectedOptions)
                          .map((o) => o.value)
                          .slice(0, 5),
                      )
                    }
                  >
                    {m.players
                      .filter(
                        (p) => p.owner === (side === "give" ? team : other),
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            ))}
          </div>
          <button
            className="button"
            disabled={team === other || !give.length || !get.length}
            onClick={() =>
              void attempt(async () => {
                const payload = newJournalOffer(
                  m,
                  { teamA: team, teamB: other, give, get },
                  ownTeam,
                  new Date().toISOString(),
                );
                const entries: JournalEntry[] = parent
                  ? linkedJournalOffer(parent, payload)
                  : [{ id: crypto.randomUUID(), kind: "offer", payload }];
                await journal.put(entries);
                setParent(null);
                setGive([]);
                setGet([]);
              })
            }
          >
            Record pending offer
          </button>
          {parent && (
            <button onClick={() => setParent(null)}>Cancel counter</button>
          )}
        </details>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Week / negotiation</th>
                <th>Proposer → recipient</th>
                <th>Offer → request</th>
                <th>Outcome / details</th>
              </tr>
            </thead>
            <tbody>
              {offers.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    {entry.payload.week ?? "Unknown"}
                    <small>
                      {entry.id}
                      {entry.payload.parent
                        ? ` · counter to ${entry.payload.parent}`
                        : ""}
                    </small>
                  </td>
                  <td>
                    {entry.payload.teamNames[entry.payload.draft.teamA] ??
                      entry.payload.draft.teamA}{" "}
                    →{" "}
                    {entry.payload.teamNames[entry.payload.draft.teamB] ??
                      entry.payload.draft.teamB}
                  </td>
                  <td>
                    {names(entry.payload.draft.give, entry)} →{" "}
                    {names(entry.payload.draft.get, entry)}
                  </td>
                  <td>
                    <label>
                      <span className="sr-only">Outcome for {entry.id}</span>
                      <select
                        value={entry.payload.outcome}
                        onChange={(e) => {
                          const outcome = e.target
                            .value as typeof entry.payload.outcome;
                          void attempt(() =>
                            journal.put([
                              {
                                ...entry,
                                payload: {
                                  ...entry.payload,
                                  outcome,
                                  responses: [
                                    ...entry.payload.responses,
                                    {
                                      outcome,
                                      actor: entry.payload.responseActor,
                                      recordedUTC: new Date().toISOString(),
                                    },
                                  ],
                                },
                              },
                            ]),
                          );
                        }}
                      >
                        {[
                          "pending",
                          "accepted",
                          "rejected",
                          "countered",
                          "unknown",
                        ].map((outcome) => (
                          <option key={outcome}>{outcome}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      onClick={() => {
                        setParent(entry);
                        setTeam(entry.payload.draft.teamB);
                        setOther(entry.payload.draft.teamA);
                        setGive(entry.payload.draft.get);
                        setGet(entry.payload.draft.give);
                      }}
                    >
                      Create counter
                    </button>
                    <details>
                      <summary>Record / forecasts</summary>
                      <p>
                        {entry.payload.provenance} · {entry.payload.recordedUTC}
                      </p>
                      {/* Attribution is explicit so a user's own responses never silently train the opponent model. */}
                      <label className="control">
                        <span>Response actor</span>
                        <select
                          value={entry.payload.responseActor}
                          onChange={(e) => {
                            const actor = e.target.value;
                            void attempt(() =>
                              journal.put([
                                {
                                  ...entry,
                                  payload: {
                                    ...entry.payload,
                                    responseActor: actor,
                                  },
                                },
                              ]),
                            );
                          }}
                        >
                          {[
                            entry.payload.draft.teamA,
                            entry.payload.draft.teamB,
                          ].map((id) => (
                            <option key={id} value={id}>
                              {entry.payload.teamNames[id] ?? id}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={entry.payload.recipientIsUser}
                          onChange={(e) => {
                            const mine = e.target.checked;
                            void attempt(() =>
                              journal.put([
                                {
                                  ...entry,
                                  payload: {
                                    ...entry.payload,
                                    recipientIsUser: mine,
                                  },
                                },
                              ]),
                            );
                          }}
                        />
                        My response — exclude from opponent tracking
                      </label>
                      <label className="control">
                        <span>
                          Notes (attributed observations, not inferred facts)
                        </span>
                        <textarea
                          defaultValue={entry.payload.notes}
                          onBlur={(e) => {
                            if (e.target.value !== entry.payload.notes)
                              void attempt(() =>
                                journal.put([
                                  {
                                    ...entry,
                                    payload: {
                                      ...entry.payload,
                                      notes: e.target.value,
                                    },
                                  },
                                ]),
                              );
                          }}
                        />
                      </label>
                      {journal.entries
                        .filter(
                          (e) =>
                            e.kind === "forecast" &&
                            e.payload.offer === entry.id,
                        )
                        .map(
                          (e) =>
                            e.kind === "forecast" && (
                              <details key={e.id}>
                                <summary>
                                  {e.payload.origin} forecast ·{" "}
                                  {e.payload.recordedUTC}
                                </summary>
                                <p>
                                  Original rules {e.payload.assessment.version}{" "}
                                  ·{" "}
                                  {e.payload.assessment.range?.join("–") ??
                                    "No range"}
                                  %
                                </p>
                                <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                              </details>
                            ),
                        )}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel
        title="Imported historical evidence"
        note="Source snapshots from the journal supplement; these are not prospective forecasts."
      >
        <details>
          <summary>
            {journal.entries.filter((e) => e.kind === "context").length} stored
            source chunks
          </summary>
          {journal.entries
            .filter((e) => e.kind === "context")
            .map(
              (e) =>
                e.kind === "context" && (
                  <details key={e.id}>
                    <summary>
                      {e.payload.source} · {e.payload.rows.length} rows
                    </summary>
                    <pre>{JSON.stringify(e.payload.rows, null, 2)}</pre>
                  </details>
                ),
            )}
        </details>
      </Panel>
      <Panel
        title="Manager profiles"
        note="Saved assumptions, not proven personality traits. Search overrides do not change these defaults."
      >
        {m.dataset.tables.ModelTeams.map((t) => {
          const id = str(t.TeamID),
            existing = journal.entries.find(
              (e): e is Extract<JournalEntry, { kind: "profile" }> =>
                e.kind === "profile" && e.payload.team === id,
            ),
            profile = existing?.payload ?? {
              team: id,
              preset: 2,
              cornerstones: [],
              notes: "",
              reviewed: [],
            },
            suggestion = profileSuggestion(journal.entries, id);
          const write = (patch: Partial<typeof profile>) =>
            journal.put([
              {
                id: existing?.id ?? `profile:${id}`,
                kind: "profile",
                payload: { ...profile, ...patch },
              },
            ]);
          return (
            <details key={id}>
              <summary>
                {str(t.TeamName)} · {managerPresetNames[profile.preset]}
              </summary>
              <label className="control">
                <span>Default negotiating preset</span>
                <select
                  value={profile.preset}
                  onChange={(e) =>
                    void attempt(() =>
                      write({ preset: Number(e.target.value) }),
                    )
                  }
                >
                  {managerPresetNames.map((label, i) => (
                    <option key={label} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="control">
                <span>Manager cornerstones (explicit user assumption)</span>
                <select
                  multiple
                  value={profile.cornerstones}
                  onChange={(e) =>
                    void attempt(() =>
                      write({
                        cornerstones: Array.from(e.target.selectedOptions).map(
                          (o) => o.value,
                        ),
                      }),
                    )
                  }
                >
                  {m.players
                    .filter((p) => p.owner === id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="control">
                <span>Attributed observations / assumptions</span>
                <textarea
                  defaultValue={profile.notes}
                  onBlur={(e) => {
                    if (e.target.value !== profile.notes)
                      void attempt(() => write({ notes: e.target.value }));
                  }}
                />
              </label>
              {suggestion &&
                !suggestion.ids.every((id) =>
                  profile.reviewed.includes(id),
                ) && (
                  <p>
                    {suggestion.message}{" "}
                    <button
                      onClick={() =>
                        void attempt(() =>
                          write({
                            reviewed: [
                              ...new Set([
                                ...profile.reviewed,
                                ...suggestion.ids,
                              ]),
                            ],
                          }),
                        )
                      }
                    >
                      Mark reviewed
                    </button>
                  </p>
                )}
            </details>
          );
        })}
      </Panel>
      <Panel
        title="Prospective acceptance tracking"
        note="Real opposing responses only. Historical imports and simulations are not prospective validation."
      >
        <table>
          <thead>
            <tr>
              <th>Band</th>
              <th>Accepted / tried</th>
              <th>Distinct negotiations</th>
            </tr>
          </thead>
          <tbody>
            {journalCalibration(journal.entries).map((bin) => (
              <tr key={bin.band}>
                <td>{acceptanceLabels[bin.band + 2]}</td>
                <td className="fact">
                  {bin.accepted} / {bin.tried}
                </td>
                <td>{bin.negotiations}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}
