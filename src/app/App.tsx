import { starterLineupsKey } from "../domain/starter-lineups";
import { lineupBasisKey } from "../domain/trade-impact";
import { reconcileSavedTrades, savedTradesKey } from "../domain/saved-trades";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  LayoutDashboard,
  Users,
  Search,
  ArrowLeftRight,
  Diamond,
  CalendarDays,
  SlidersHorizontal,
  Database,
  Upload,
  ShieldCheck,
  Cloud,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import {
  initialState,
  num,
  str,
  type Workspace,
  type Dataset,
  type Draft,
} from "../domain/contracts";
import type { Model } from "../domain/valuation";
import { evidenceKey, roleScenarioKey } from "../domain/opportunity";
import { EvidenceSettings } from "../features/EvidenceSettings";
import type { PositionGrade } from "../domain/lineups";
import { teamsAssessment } from "../domain/lineups";
import { RosterSimulator } from "../features/RosterSimulator";
import {
  activeRosterScenario,
  applyRosterScenario,
  appendScenarioTrade,
  readRosterScenarios,
  writeRosterScenarios,
  rosterScenariosKey,
  rosterScenarioDirty,
  saveRosterSnapshot,
  scenarioRosterBase,
  deleteRosterScenario,
  type RosterSaveSlot,
  selectMyTeam,
  type RosterScenario,
} from "../domain/roster-scenarios";
import { load, save, remove, observeGemTracking } from "../storage/workspace";
import type { GemTrackingState } from "../domain/gem-tracking";
import {
  getConfig,
  putConfig,
  cloudClient,
  signOutFantasy,
  pull,
  sync,
  acknowledgeSync,
  Conflict,
  type CloudConfig,
} from "../sync/client";
import { Legend } from "../ui/components";
import { Panel } from "../ui/layout";
import { PlayerPopoverProvider } from "../ui/PlayerPopover";
import {
  Welcome,
  Overview,
  TeamView,
  PlayerList,
  PlayerDetail,
  GemView,
  Weekly,
  TradeView,
  ModelView,
  Account,
} from "../features/views";
const nav = [
  ["overview", "My team", LayoutDashboard],
  ["teams", "League teams", Users],
  ["players", "Players", Search],
  ["trades", "Trade analyzer", ArrowLeftRight],
  ["gems", "Gem screener", Diamond],
  ["weekly", "Weekly streamers", CalendarDays],
  ["model", "Model & audit", SlidersHorizontal],
  ["data", "Data & account", Database],
] as const;
const labels: Record<string, string> = Object.fromEntries(
  nav.map(([key, label]) => [key, label]),
);
// Report this running bundle's release rather than the workbook or calculation-model version.
const appRelease = {
  version: import.meta.env.VITE_APP_VERSION,
  build: import.meta.env.VITE_APP_BUILD,
  commit: import.meta.env.VITE_APP_COMMIT,
  builtAt: import.meta.env.VITE_APP_BUILT_AT,
};
function readRoute() {
  return location.hash.startsWith("#/")
    ? location.hash.slice(2) || "overview"
    : "overview";
}
function useRoute() {
  const [route, set] = useState(readRoute);
  useEffect(() => {
    const fn = () => set(readRoute());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return route;
}
export default function App() {
  const route = useRoute(),
    [w, setW] = useState<Workspace | null>(null),
    wRef = useRef<Workspace | null>(null),
    [ready, setReady] = useState(false),
    [realModel, setModel] = useState<Model | null>(null),
    [grades, setGrades] = useState<Map<string, PositionGrade[]>>(new Map()),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [calculating, setCalculating] = useState(false),
    [preview, setPreview] = useState<{
      dataset: Dataset;
      summary: string;
    } | null>(null),
    [mobile, setMobile] = useState(false),
    [config, setConfig] = useState<CloudConfig>(getConfig),
    [email, setEmail] = useState(""),
    [syncStatus, setSyncStatus] = useState("Local only"),
    [conflict, setConflict] = useState<Workspace | null | undefined>(undefined),
    [updateReady, setUpdateReady] = useState(false);
  const client = useMemo(() => cloudClient(config), [config.url, config.key]),
    fileRef = useRef<HTMLInputElement>(null),
    importRef = useRef<Worker | null>(null),
    importTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveQueue = useRef(Promise.resolve()),
    // Keep background audit completion from rerendering unrelated active screens or interrupting their focus.
    gemTracking = useRef<{
      owner: string;
      hash: string;
      result: Promise<GemTrackingState>;
    } | null>(null),
    syncBusy = useRef(false);
  // Scenario edits remain in memory across routes; ordinary workspace/cloud saves never serialize this working draft.
  const [rosterDraft, setRosterDraft] = useState<string | null>(null);
  const rosterDraftRef = useRef<string | null>(null);
  const scenarioRaw = rosterDraft ?? w?.state.filters[rosterScenariosKey];
  const unsavedRosters = rosterScenarioDirty(
    w?.state.filters[rosterScenariosKey],
    scenarioRaw,
  );
  // Native unload protection covers refresh/close while ordinary in-app navigation preserves the draft.
  useEffect(() => {
    if (!unsavedRosters) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsavedRosters]);
  // Only analysis views receive projected ownership. The calculation worker and prospective journal still receive the real import.
  const model = useMemo(
    () =>
      realModel
        ? applyRosterScenario(
            realModel,
            activeRosterScenario(scenarioRaw),
            w?.state.filters[starterLineupsKey],
          )
        : null,
    [realModel, scenarioRaw, w?.state.filters[starterLineupsKey]],
  );
  const analysisGrades = useMemo(
    () => (model?.simulation ? teamsAssessment(model) : grades),
    [model, grades],
  );
  function commit(next: Workspace | null) {
    // Ownership cleanup runs for local loads, imports and cloud adoption, including outside Trade Analyzer.
    next = reconcileSavedTrades(next);
    // A remembered My Team is authoritative on load/import; an unrelated roster browser or legacy draft cannot replace it.
    if (next?.dataset) {
      const selected = next.dataset.tables.ModelTeams.some(
        (t) => str(t.TeamID) === next!.state.preferredTeam,
      )
        ? next.state.preferredTeam
        : initialState(next.dataset).preferredTeam;
      next = {
        ...next,
        state: selectMyTeam(next.state, next.dataset, selected),
      };
    }
    // An account change must never expose another account's unsaved hypothetical roster.
    if (wRef.current?.owner !== next?.owner) {
      rosterDraftRef.current = null;
      setRosterDraft(null);
    }
    wRef.current = next;
    setW(next);
    if (next)
      saveQueue.current = saveQueue.current
        .then(() => save(next))
        .catch((e) => setError(`Could not save locally: ${e.message}`));
  }
  useEffect(() => {
    const notify = () => setUpdateReady(true);
    // Clear a previously offered update when the current entry is verified as the published release.
    const current = () => setUpdateReady(false);
    window.addEventListener("fantasy-update-ready", notify);
    window.addEventListener("fantasy-update-current", current);
    return () => {
      window.removeEventListener("fantasy-update-ready", notify);
      window.removeEventListener("fantasy-update-current", current);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    load()
      .then((x) => {
        if (alive) {
          if (!wRef.current) commit(x);
          setReady(true);
        }
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!client) return;
    let alive = true;
    const adopt = async (session: any) => {
      if (!alive) return;
      setEmail(session?.user?.email ?? "");
      if (session?.user) {
        const owner = session.user.id;
        if (wRef.current?.owner === owner) return;
        try {
          const existing = await load(owner),
            local = wRef.current;
          if (!alive) return;
          if (existing) commit(existing);
          else if (local?.owner === "local") {
            commit({
              ...local,
              owner,
              datasetRevision: 0,
              stateRevision: 0,
              pendingDataset: !!local.dataset,
              pendingState: true,
              requestId: crypto.randomUUID(),
              stateRequestId: crypto.randomUUID(),
            });
          } else {
            const remote = await pull(client, owner);
            if (!alive) return;
            commit(remote);
          }
          setSyncStatus("Ready to sync");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setSyncStatus("Sync failed");
        }
      } else setSyncStatus("Local only");
    };
    client.auth.getSession().then(({ data }) => adopt(data.session));
    const { data } = client.auth.onAuthStateChange((_e, session) => {
      setTimeout(() => adopt(session), 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [client]);
  useEffect(() => {
    if (!w?.dataset) {
      setModel(null);
      setGrades(new Map());
      return;
    }
    const worker = new Worker(
        new URL("../workers/model.worker.ts", import.meta.url),
        { type: "module" },
      ),
      id = crypto.randomUUID();
    setCalculating(true);
    setModel(null);
    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (e.data.error) setError(e.data.error);
      else {
        setModel(e.data.result.model);
        setGrades(new Map(e.data.result.grades));
        // Serialize tracking behind workspace saves and discard obsolete/account-switched results without blocking calculations.
        const result: Model = e.data.result.model,
          owner = w.owner,
          hash = result.dataset.hash;
        const observation = saveQueue.current.then(
          async (): Promise<GemTrackingState> => {
            if (
              wRef.current?.owner !== owner ||
              wRef.current.dataset?.hash !== hash
            )
              return {
                journal: { version: 1, cohorts: [] },
                status: "Waiting for the current workspace.",
              };
            try {
              return await observeGemTracking(owner, result);
            } catch {
              return {
                journal: { version: 1, cohorts: [] },
                status:
                  "Could not access local Gem tracking. Live labels and calculations remain available; retry by reopening the app.",
              };
            }
          },
        );
        gemTracking.current = { owner, hash, result: observation };
        saveQueue.current = observation.then(() => {});
      }
      setCalculating(false);
    };
    worker.onerror = () => {
      setError("Calculation worker failed. Reload and try again.");
      setCalculating(false);
    };
    worker.postMessage({
      id,
      type: "model",
      dataset: w.dataset,
      settings: w.state.settings,
      filters: w.state.filters,
    });
    return () => worker.terminate();
  }, [
    w?.owner,
    w?.dataset?.hash,
    JSON.stringify(w?.state.settings),
    w?.state.filters[evidenceKey],
    w?.state.filters[roleScenarioKey],
  ]);
  async function runSync(force = false) {
    const current = wRef.current;
    if (!client || !current || current.owner === "local") {
      setError("Sign in and import a workbook before syncing.");
      return;
    }
    if (syncBusy.current) return;
    syncBusy.current = true;
    setSyncStatus("Syncing");
    try {
      await saveQueue.current;
      const next = await sync(client, current, force);
      if (wRef.current?.owner !== current.owner) return;
      // Preserve newer settings/imports while recording the revisions this sync actually committed.
      const acknowledged = acknowledgeSync(wRef.current, current, next);
      if (!acknowledged) return;
      commit(acknowledged);
      setConflict(undefined);
      setSyncStatus(
        wRef.current?.pendingState || wRef.current?.pendingDataset
          ? "Changes pending; sync again"
          : "Synced",
      );
    } catch (e) {
      // An obsolete request must not show another account's conflict or failure after switching accounts.
      if (wRef.current?.owner !== current.owner) return;
      if (e instanceof Conflict) {
        setConflict(e.remote);
        setSyncStatus("Conflict");
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setSyncStatus(
          navigator.onLine ? "Sync failed" : "Offline changes pending",
        );
      }
    } finally {
      syncBusy.current = false;
    }
  }
  useEffect(() => {
    const onFocus = () => {
      if (wRef.current?.owner !== "local" && client && conflict === undefined)
        void runSync();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [client, conflict]);
  function updateState(patch: Partial<Workspace["state"]>) {
    const current = wRef.current;
    if (current) {
      commit({
        ...current,
        state: { ...current.state, ...patch },
        pendingState: true,
        stateRequestId: crypto.randomUUID(),
      });
      setSyncStatus(
        current.owner === "local" ? "Local only" : "Changes pending",
      );
    }
  }
  // Validate staged edits without saving roster recipes; only an existing active-mode preference may persist separately.
  function stageRosterScenarios(raw: string) {
    const current = wRef.current;
    if (!current) return false;
    try {
      const saved = readRosterScenarios(
        current.state.filters[rosterScenariosKey],
      );
      if (!raw && saved.issue) {
        updateState({
          filters: { ...current.state.filters, [rosterScenariosKey]: "" },
        });
        rosterDraftRef.current = null;
        setRosterDraft(null);
        return true;
      }
      const read = readRosterScenarios(raw);
      if (read.issue) throw Error(read.issue);
      const validated = writeRosterScenarios(current.state, read.collection);
      rosterDraftRef.current = validated;
      setRosterDraft(validated);
      if (
        !saved.issue &&
        saved.collection.active !== read.collection.active &&
        (!read.collection.active ||
          saved.collection.scenarios.some(
            (scenario) => scenario.id === read.collection.active,
          ))
      ) {
        updateState({
          filters: {
            ...current.state.filters,
            [rosterScenariosKey]: writeRosterScenarios(current.state, {
              ...saved.collection,
              active: read.collection.active,
            }),
          },
        });
      }
      setError("");
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not stage roster changes.",
      );
      return false;
    }
  }
  // One Save click atomically commits the current recipe and chosen slot; other scenarios' drafts stay unsaved.
  function saveScenarioSlot(slot: RosterSaveSlot) {
    const current = wRef.current;
    if (!current) return false;
    try {
      const next = saveRosterSnapshot(
        current.state,
        rosterDraftRef.current ??
          current.state.filters[rosterScenariosKey] ??
          "",
        slot,
        new Date().toISOString(),
        realModel ? scenarioRosterBase(realModel) : undefined,
      );
      updateState({
        filters: { ...current.state.filters, [rosterScenariosKey]: next.saved },
      });
      rosterDraftRef.current = next.working;
      setRosterDraft(next.working);
      setError("");
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save roster snapshot.",
      );
      return false;
    }
  }
  // Delete is an explicit management action; it never saves unrelated working roster changes.
  function deleteScenario(id: string) {
    const current = wRef.current;
    if (!current) return false;
    try {
      const next = deleteRosterScenario(
        current.state,
        rosterDraftRef.current ??
          current.state.filters[rosterScenariosKey] ??
          "",
        id,
      );
      updateState({
        filters: { ...current.state.filters, [rosterScenariosKey]: next.saved },
      });
      rosterDraftRef.current = next.working;
      setRosterDraft(next.working);
      setError("");
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not delete roster scenario.",
      );
      return false;
    }
  }
  // Restoring a saved hypothetical trade recreates its own recipe, independently of subsequent edits to a named scenario.
  function restoreScenario(scenario?: RosterScenario) {
    const current = wRef.current;
    if (!current) return false;
    try {
      const read = readRosterScenarios(
        rosterDraftRef.current ?? current.state.filters[rosterScenariosKey],
      );
      if (read.issue) throw Error(read.issue);
      const copy = scenario
        ? { ...scenario, id: "saved-" + scenario.id.replace(/^saved-/, "") }
        : undefined;
      const collection = {
        ...read.collection,
        active: copy?.id ?? "",
        scenarios: copy
          ? [...read.collection.scenarios.filter((s) => s.id !== copy.id), copy]
          : read.collection.scenarios,
      };
      return stageRosterScenarios(
        writeRosterScenarios(current.state, collection),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not restore simulation.",
      );
      return false;
    }
  }
  // Applying a completed trade changes one private recipe and both ownership sides, never the imported league snapshot.
  function forceScenarioTrade(draft: Draft) {
    const current = wRef.current;
    if (!current?.dataset || !realModel) return false;
    try {
      if (realModel.dataset.hash !== current.dataset.hash)
        throw Error(
          "Wait for the current import to finish before applying a hypothetical trade.",
        );
      const read = readRosterScenarios(
        rosterDraftRef.current ?? current.state.filters[rosterScenariosKey],
      );
      if (read.issue) throw Error(read.issue);
      const selected = read.collection.scenarios.find(
        (s) => s.id === read.collection.active,
      );
      const scenario: RosterScenario = selected ?? {
        id: crypto.randomUUID(),
        name: "Forced trade scenario",
        team: draft.teamA,
        season: num(current.dataset.tables.ModelContext[0].Season),
        sourceHash: current.dataset.hash,
        moves: [],
        cursor: 0,
      };
      const projected = applyRosterScenario(
        realModel,
        selected,
        current.state.filters[starterLineupsKey],
      );
      const next = appendScenarioTrade(
        projected,
        {
          ...scenario,
          baseLineups:
            scenario.baseLineups ??
            current.state.filters[starterLineupsKey] ??
            "",
          baseRoster: scenario.baseRoster ?? scenarioRosterBase(realModel),
        },
        draft,
      );
      const collection = {
        ...read.collection,
        active: next.id,
        scenarios: selected
          ? read.collection.scenarios.map((s) => (s.id === next.id ? next : s))
          : [...read.collection.scenarios, next],
      };
      const raw = writeRosterScenarios(current.state, collection);
      if (!stageRosterScenarios(raw)) return false;
      // Clear the consumed trade draft without persisting the unsaved roster recipe.
      updateState({ draft: { ...draft, give: [], get: [] } });
      setError("");
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not apply hypothetical trade.",
      );
      return false;
    }
  }
  async function importFile(file: File) {
    setError("");
    if (file.size > 25 * 1024 * 1024) {
      setError("Workbook exceeds 25 MiB.");
      return;
    }
    setBusy(true);
    setPreview(null);
    importRef.current?.terminate();
    if (importTimer.current) clearTimeout(importTimer.current);
    const worker = new Worker(
      new URL("../workers/import.worker.ts", import.meta.url),
      { type: "module" },
    );
    importRef.current = worker;
    const id = crypto.randomUUID();
    importTimer.current = setTimeout(() => {
      worker.terminate();
      setBusy(false);
      setError("Import exceeded 30 seconds. Your current dataset is intact.");
    }, 30000);
    worker.onmessage = (e) => {
      if (e.data.id !== id) return;
      if (importTimer.current) clearTimeout(importTimer.current);
      setBusy(false);
      if (e.data.error) setError(e.data.error);
      else setPreview(e.data.result);
      worker.terminate();
    };
    worker.onerror = () => {
      if (importTimer.current) clearTimeout(importTimer.current);
      setBusy(false);
      setError("Workbook could not be parsed. The existing dataset is intact.");
      worker.terminate();
    };
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (importRef.current === worker)
        worker.postMessage({ id, bytes }, [bytes.buffer]);
    } catch {
      if (importTimer.current) clearTimeout(importTimer.current);
      worker.terminate();
      setBusy(false);
      setError(
        "Could not read the selected workbook. Your current dataset is intact.",
      );
    }
  }
  async function acceptImport(useImported = false) {
    if (!preview) return;
    const dataset = preview.dataset,
      current = wRef.current,
      state = current
        ? {
            ...current.state,
            settings: useImported ? dataset.settings : current.state.settings,
            draft: {
              ...current.state.draft,
              give: current.state.draft.give.filter((id) =>
                dataset.tables.ModelPlayers.some(
                  (p) =>
                    str(p.PlayerID) === id &&
                    (activeRosterScenario(
                      rosterDraftRef.current ??
                        current.state.filters[rosterScenariosKey],
                    ) ||
                      str(p.OnTeamID) === current.state.draft.teamA),
                ),
              ),
              get: current.state.draft.get.filter((id) =>
                dataset.tables.ModelPlayers.some(
                  (p) =>
                    str(p.PlayerID) === id &&
                    (activeRosterScenario(
                      rosterDraftRef.current ??
                        current.state.filters[rosterScenariosKey],
                    ) ||
                      str(p.OnTeamID) === current.state.draft.teamB),
                ),
              ),
            },
          }
        : initialState(dataset);
    const { data } = client
      ? await client.auth.getSession()
      : { data: { session: null } };
    commit({
      dataset,
      state,
      owner: data.session?.user.id ?? current?.owner ?? "local",
      datasetRevision: current?.datasetRevision ?? 0,
      stateRevision: current?.stateRevision ?? 0,
      pendingDataset: true,
      pendingState: true,
      requestId: crypto.randomUUID(),
      stateRequestId: crypto.randomUUID(),
    });
    setPreview(null);
    setSyncStatus(
      wRef.current?.owner === "local" ? "Local only" : "Changes pending",
    );
    location.hash = "#/overview";
  }
  async function signOut() {
    const owner = wRef.current?.owner;
    await saveQueue.current;
    if (client) {
      try {
        await signOutFantasy(client);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    if (owner) await remove(owner);
    commit(null);
    setModel(null);
    setConflict(undefined);
  }
  const d = w?.dataset,
    currentTeam = d?.tables.ModelTeams.find(
      (t) => str(t.TeamID) === w?.state.preferredTeam,
    ),
    stale =
      !!d && (!d.sourceUTC || Date.now() - Date.parse(d.sourceUTC) > 86400000),
    page = route.split("/")[0];
  const content = (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <a className="brand" href="#/overview">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
          <span>
            FANTASY<span>FOOTBALL LAB</span>
          </span>
        </a>
        <div className="workspace-tag">
          <span className="live-dot" /> YOUR LEAGUE WORKSPACE
        </div>
        <nav aria-label="Main navigation">
          {nav.map(([key, label, Icon]) => (
            <a
              key={key}
              className={page === key ? "active" : ""}
              href={`#/${key}`}
              onClick={() => setMobile(false)}
            >
              <Icon size={18} />
              {label}
              {page === key && <ChevronRight size={15} />}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <p>
            Your league. Your data.
            <small>One current snapshot. No Excel archive.</small>
          </p>
          <a href="#/data" className="sync-pill">
            <Cloud size={14} />
            {syncStatus}
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-menu subtle"
            aria-label="Toggle navigation"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />{" "}
            <b>{labels[page] ?? "Player detail"}</b>
          </div>
          <div className="top-actions">
            {d && (
              <span className="week-label">
                Week {num(d.tables.ModelContext[0].CurrentWeek)}{" "}
                <span> / {num(d.tables.ModelContext[0].FinalWeek)}</span>
              </span>
            )}
            <button
              className="button primary"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
            >
              <Upload size={16} />
              {busy ? "Reading workbook…" : "Import workbook"}
            </button>
          </div>
        </header>
        <div className="content">
          <div className="toolbar">
            {/* This explicit account-synced selector is separate from browsing opponents. */}
            {d && w && (
              <label className="control">
                <span>My team</span>
                <select
                  aria-label="My team"
                  value={w.state.preferredTeam}
                  onChange={(event) =>
                    updateState(
                      selectMyTeam(wRef.current!.state, d, event.target.value),
                    )
                  }
                >
                  {d.tables.ModelTeams.map((team) => (
                    <option key={str(team.TeamID)} value={str(team.TeamID)}>
                      {str(team.TeamName)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {/* The visible mode applies consistently across roster/trade/search views and always offers an explicit return to live data. */}
          {model?.simulation && w && (
            <div className="notice warning toolbar" role="status">
              <strong>Hypothetical: {model.simulation.scenario.name}</strong> ·
              Player indices use the real snapshot.{" "}
              {rosterScenarioDirty(
                w.state.filters[rosterScenariosKey],
                scenarioRaw,
                model.simulation.scenario.id,
              ) && (
                <span>
                  Unsaved roster changes.{" "}
                  <a href="#/overview">Save a roster slot on My team.</a>{" "}
                </span>
              )}
              {model.simulation.rebased &&
                "Updated player data applied to saved moves."}
              <button className="button" onClick={() => restoreScenario()}>
                Return to live roster
              </button>
              {model.simulation.issues.map((issue) => (
                <p key={issue}>
                  {issue} Analysis is conditional until resolved.
                </p>
              ))}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                FANTASY FOOTBALL /{" "}
                {d
                  ? `${num(d.tables.ModelContext[0].Season)} SEASON`
                  : "YOUR NEXT ROSTER DECISION"}
              </div>
              <h1>
                {page === "overview"
                  ? str(currentTeam?.TeamName) || "Your roster, in focus."
                  : page === "player"
                    ? "Player evaluation"
                    : (labels[page] ?? "Fantasy Football Lab")}
              </h1>
              <p>
                {page === "overview"
                  ? "Understand your strengths. Find your next advantage."
                  : "Recorded evidence, projections and model estimates, clearly separated."}
              </p>
            </div>
            {d && (
              <div className={`snapshot ${stale ? "stale" : ""}`}>
                <span>{stale ? "Stale snapshot" : "Snapshot loaded"}</span>
                <small>
                  {d.sourceUTC
                    ? new Date(d.sourceUTC).toLocaleString()
                    : "Refresh time unavailable"}
                </small>
              </div>
            )}
          </div>
          {updateReady && (
            <div className="notice">
              An app update is ready. Your current dataset will be preserved.
              <button
                className="button"
                onClick={async () => {
                  // Finish queued IndexedDB writes before the explicit reload; recovery never clears workspace storage.
                  await saveQueue.current;
                  window.dispatchEvent(new Event("fantasy-app-recover"));
                }}
              >
                Reload app
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="notice danger">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {stale && (
            <div className="notice warning">
              This source snapshot is older than 24 hours or has no refresh
              time. Refresh and save Excel, then import it again.
            </div>
          )}
          {/* Scenario assumptions stay visible on every screen, including roster rankings. */}
          {model && model.roleScenarioWeight > 0 && (
            <div className="notice warning" role="status">
              Experimental role forecast scenario:{" "}
              {Math.round(model.roleScenarioWeight * 100)}% role model,{" "}
              {Math.round((1 - model.roleScenarioWeight) * 100)}% original blend
              where role data is usable. Change it in Model &amp; audit.
            </div>
          )}
          {model?.evidenceIssue && (
            <div className="notice warning">{model.evidenceIssue}</div>
          )}
          {busy && (
            <div className="notice">
              Reading and validating locally. Your current dataset remains
              intact.{" "}
              <button
                onClick={() => {
                  importRef.current?.terminate();
                  if (importTimer.current) clearTimeout(importTimer.current);
                  setBusy(false);
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {preview && (
            <Panel title="Review workbook import" note={preview.summary}>
              <p>
                Source:{" "}
                {preview.dataset.sourceUTC
                  ? new Date(preview.dataset.sourceUTC).toLocaleString()
                  : "unavailable"}
                . This will replace the current extracted dataset. The original
                Excel file will not be stored or uploaded.
              </p>
              {preview.dataset.issues.map((x, i) => (
                <p key={i} className="warning">
                  {x}
                </p>
              ))}
              <details>
                <summary>Imported settings</summary>
                <pre>{JSON.stringify(preview.dataset.settings, null, 2)}</pre>
              </details>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => acceptImport(false)}
                >
                  Replace dataset{w ? " · keep app settings" : ""}
                </button>
                {w && (
                  <button className="button" onClick={() => acceptImport(true)}>
                    Replace and use workbook settings
                  </button>
                )}
                <button className="subtle" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </div>
            </Panel>
          )}
          {conflict !== undefined && (
            <Panel
              title="Choose your current workspace"
              note="Another device changed cloud data, or this account has no cloud workspace yet."
            >
              <div className="two-col">
                <div>
                  <h3>This device</h3>
                  <p>{d?.sourceUTC ?? "No source time"}</p>
                </div>
                <div>
                  <h3>Cloud</h3>
                  <p>{conflict?.dataset?.sourceUTC ?? "No cloud workspace"}</p>
                </div>
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => runSync(true)}
                >
                  Keep this device and replace cloud
                </button>
                {conflict && (
                  <button
                    className="button"
                    onClick={() => {
                      commit(conflict);
                      setConflict(undefined);
                      setSyncStatus(
                        wRef.current?.pendingState
                          ? "Changes pending"
                          : "Synced",
                      );
                    }}
                  >
                    Use cloud workspace
                  </button>
                )}
                <button
                  className="subtle"
                  onClick={() => setConflict(undefined)}
                >
                  Decide later
                </button>
              </div>
            </Panel>
          )}
          {calculating && (
            <div className="notice" role="status">
              Calculating the current snapshot…
            </div>
          )}
          {!ready ? (
            <p>Opening your workspace…</p>
          ) : !d && !preview && page !== "data" ? (
            <Welcome onImport={() => fileRef.current?.click()} />
          ) : model && w ? (
            <>
              {page === "overview" && (
                <>
                  <RosterSimulator
                    real={realModel!}
                    model={model}
                    state={{
                      ...w.state,
                      filters: {
                        ...w.state.filters,
                        [rosterScenariosKey]: scenarioRaw ?? "",
                      },
                    }}
                    savedRaw={w.state.filters[rosterScenariosKey]}
                    change={stageRosterScenarios}
                    saveSlot={saveScenarioSlot}
                    deleteScenario={deleteScenario}
                  />
                  <Overview
                    m={model}
                    grades={analysisGrades.get(w.state.preferredTeam) ?? []}
                    team={w.state.preferredTeam}
                    filters={w.state.filters}
                    onFilters={(patch) =>
                      updateState({
                        filters: { ...wRef.current!.state.filters, ...patch },
                      })
                    }
                  />
                </>
              )}
              {page === "teams" && (
                <TeamView
                  m={model}
                  grades={analysisGrades}
                  team={w.state.filters.browsedTeam || w.state.preferredTeam}
                  change={(browsedTeam) =>
                    updateState({
                      filters: { ...wRef.current!.state.filters, browsedTeam },
                    })
                  }
                />
              )}
              {page === "players" && (
                <PlayerList
                  m={model}
                  filters={w.state.filters}
                  onFilters={(patch) =>
                    updateState({ filters: { ...w.state.filters, ...patch } })
                  }
                />
              )}
              {page === "player" && (
                <PlayerDetail m={model} id={route.split("/")[1]} />
              )}
              {page === "gems" && (
                <GemView
                  // Account changes must also discard another account's draft filters.
                  key={w.owner}
                  m={model}
                  filters={w.state.filters}
                  onFilters={(patch) =>
                    updateState({ filters: { ...w.state.filters, ...patch } })
                  }
                />
              )}
              {page === "weekly" && <Weekly m={model} />}
              {page === "trades" && (
                // Account changes reset temporary search results and terminate the previous account's worker.
                <TradeView
                  key={w.owner}
                  m={model}
                  draft={w.state.draft}
                  state={w.state}
                  restoreScenario={restoreScenario}
                  forceTrade={forceScenarioTrade}
                  // Store only the analysis preference against the latest account state, preserving unrelated selections.
                  changeBasis={(basis) =>
                    updateState({
                      filters: {
                        ...wRef.current!.state.filters,
                        [lineupBasisKey]: basis,
                      },
                    })
                  }
                  // Merge only this account-state key against the latest workspace, preserving unrelated filters.
                  saveTrades={(raw) =>
                    updateState({
                      filters: {
                        ...wRef.current!.state.filters,
                        [savedTradesKey]: raw,
                      },
                    })
                  }
                  lineupsRaw={
                    model.simulation?.lineupsRaw ??
                    w.state.filters[starterLineupsKey]
                  }
                  change={(draft) =>
                    updateState({
                      ...selectMyTeam(wRef.current!.state, d!, draft.teamA),
                      draft,
                    })
                  }
                />
              )}
              {page === "model" && (
                <>
                  {/* Build details identify the installed app when diagnosing updates across devices. */}
                  <Panel title="App version">
                    <p>
                      Fantasy Football Lab v{appRelease.version} · Build{" "}
                      {appRelease.build} · Commit {appRelease.commit}
                    </p>
                    <p>
                      Built{" "}
                      <time dateTime={appRelease.builtAt}>
                        {new Date(appRelease.builtAt).toLocaleString()}
                      </time>
                      . App version is separate from your imported workbook and
                      model versions.
                    </p>
                  </Panel>
                  <EvidenceSettings
                    m={realModel!}
                    filters={w.state.filters}
                    change={(patch) =>
                      updateState({ filters: { ...w.state.filters, ...patch } })
                    }
                  />
                  <ModelView
                    m={realModel!}
                    tracking={
                      gemTracking.current?.owner === w.owner &&
                      gemTracking.current.hash === realModel?.dataset.hash
                        ? gemTracking.current.result
                        : null
                    }
                    change={(settings) => updateState({ settings })}
                  />
                </>
              )}
            </>
          ) : null}
          {page === "data" && (
            <Account
              w={w}
              config={config}
              email={email}
              configure={(c) => {
                putConfig(c);
                setConfig(c);
                setError("");
              }}
              client={client}
              runSync={() => runSync()}
              signOut={signOut}
              status={syncStatus}
              notify={setError}
              importClick={() => fileRef.current?.click()}
              clear={async (cloud) => {
                if (!w) return;
                if (
                  !confirm(
                    cloud
                      ? "Delete your current cloud workspace and this local copy?"
                      : "Remove the current dataset from this device?",
                  )
                )
                  return;
                if (cloud && client && w.owner !== "local") {
                  const { error } = await client.rpc(
                    "delete_fantasy_workspace",
                  );
                  if (error) {
                    setError(error.message);
                    return;
                  }
                }
                await saveQueue.current;
                await remove(w.owner);
                commit(null);
                setConflict(undefined);
                setSyncStatus("Local only");
              }}
            />
          )}
          <Legend />
          <footer className="footer">
            Fantasy Football Lab{" "}
            {/* Keep the running release visible on every screen, including mobile. */}
            <span>
              Adaptive model · provisional assumptions · v{appRelease.version} ·{" "}
              Build {appRelease.build}
            </span>
          </footer>
        </div>
      </main>
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        accept=".xlsx"
        aria-label="Import Excel workbook"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
  // Keep inspection state outside routed views so opening a card preserves each screen's draft.
  return <PlayerPopoverProvider m={model}>{content}</PlayerPopoverProvider>;
}
