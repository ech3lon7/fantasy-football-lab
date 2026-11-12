import { NegotiationsProvider, TradeJournal } from "../features/Negotiations";
import { starterLineupsKey } from "../domain/starter-lineups";
import { lineupBasisKey } from "../domain/trade-impact";
import {
  animationKey,
  feedback,
  feelEntry,
  readLocalFeel,
  writeLocalFeel,
  hapticsKey,
  hapticsSupported,
  readAnimationPref,
  readFlag,
  soundKey,
  useAnimationRoot,
} from "../ui/feel/settings";
import { BottomBar, GamedayHeader } from "../features/next/Shell";
import { Scouting } from "../features/next/Scouting";
import { Roster } from "../features/next/Roster";
import { Lab } from "../features/next/Lab";
import {
  TradeRoom,
  readTradeTab,
  tradeTabKey,
} from "../features/next/TradeRoom";
import { GamedayWelcome, SignalsTicker, Week } from "../features/next/Week";
import { League } from "../features/next/League";
import {
  PlayerCardProvider,
  PlayerRouteOpener,
  cardTabKey,
  readCardTab,
} from "../features/next/PlayerCard";
import {
  FeedbackProvider,
  actionCue,
  importCue,
  useFeedback,
} from "../ui/feel/feedback";
import { PopoverLayer, PopoverProvider } from "../ui/popover/PopoverStack";
import { usePlayerRowKeys } from "../ui/popover/rowNavigation";
import { labTabForRoute, pageForRoute } from "../domain/view/shell";
import { readThemePref, themeKey, useGamedayRoot } from "../ui/feel/theme";
import { reconcileSavedTrades } from "../domain/saved-trades";
import { useState, useEffect, useRef, useMemo } from "react";
import { X } from "lucide-react";
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
  appendScenarioMove,
  readRosterScenarios,
  writeRosterScenarios,
  rosterScenariosKey,
  rosterScenarioDirty,
  saveRosterSnapshot,
  clearRosterSlot,
  scenarioRosterBase,
  deleteRosterScenario,
  type RosterSaveSlot,
  selectMyTeam,
  type RosterScenario,
  type ScenarioMove,
} from "../domain/roster-scenarios";
import {
  load,
  save,
  remove,
  observeGemTracking,
  readPreviousSummary,
  writePreviousSummary,
} from "../storage/workspace";
import {
  importDigest,
  summarizeImport,
  type Digest,
} from "../domain/view/since-import";
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
import { FilterHelp } from "../ui/FilterHelp";
import { Panel } from "../ui/layout";
import { Skeleton } from "../ui/primitives";
import { ModelView } from "../features/ModelView";
import { Account } from "../features/Account";
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
    const fn = () => {
      set(readRoute());
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return route;
}
// A route change is a navigation tap; the page the app opens on is not.
function RouteFeedback({ route }: { route: string }) {
  const notify = useFeedback(),
    first = useRef(route);
  useEffect(() => {
    if (first.current === route) return;
    first.current = route;
    notify("tap");
  }, [route, notify]);
  return null;
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
    [config, setConfig] = useState<CloudConfig>(getConfig),
    [email, setEmail] = useState(""),
    [syncStatus, setSyncStatus] = useState("Local only"),
    [conflict, setConflict] = useState<Workspace | null | undefined>(undefined),
    [updateReady, setUpdateReady] = useState(false);
  // Feel choices made before an import are kept on this device and used until the workspace stores its own.
  const [localFeel, setLocalFeel] = useState<Record<string, string>>(readLocalFeel);
  const feelFilters: Record<string, string> = {
    ...localFeel,
    ...(w?.state.filters ?? {}),
  };
  // Apply the interface root and the resolved theme.
  useGamedayRoot(readThemePref(feelFilters[themeKey]));
  // Up and Down move between marked player rows.
  usePlayerRowKeys();
  // Publish the effective animation level so transitions are gated on one root attribute.
  useAnimationRoot(readAnimationPref(feelFilters[animationKey]));
  // Compare the current import with the summary kept from the previous one; nothing is shown without a previous import.
  useEffect(() => {
    if (!w || !realModel || realModel.dataset.hash !== w.dataset?.hash) {
      setDigest(null);
      return;
    }
    let live = true;
    void readPreviousSummary(w.owner).then((previous) => {
      if (live) setDigest(importDigest(previous, summarizeImport(realModel)));
    });
    return () => {
      live = false;
    };
  }, [w?.owner, realModel?.dataset.hash, w?.dataset?.hash]);
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
    syncBusy = useRef(false),
    // What changed since the previous import, read from this device's stored summary.
    [digest, setDigest] = useState<Digest | null>(null);
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
  // Journal record sync has independent revisions; expose its failures without changing workspace or saved-trade permissions.
  useEffect(() => {
    const notice = (event: Event) => {
      const detail = (event as CustomEvent<{ owner: string; issue: string }>)
        .detail;
      if (detail.owner === wRef.current?.owner)
        setSyncStatus(
          (previous) =>
            detail.issue ||
            (previous.startsWith("Journal")
              ? wRef.current?.pendingState || wRef.current?.pendingDataset
                ? "Changes pending"
                : "Synced"
              : previous),
        );
    };
    window.addEventListener("fantasy-journal-sync-status", notice);
    return () =>
      window.removeEventListener("fantasy-journal-sync-status", notice);
  }, []);
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
      // Journal sync uses separate record revisions and must not replace dataset/settings state.
      window.dispatchEvent(new Event("fantasy-sync-negotiations"));
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
        // When a cloud conflict occurs and a remote workspace exists, automatically adopt the cloud workspace and replace this device.
        if (e.remote) {
          commit(e.remote);
          setConflict(undefined);
          setSyncStatus("Synced");
          window.dispatchEvent(new Event("fantasy-sync-negotiations"));
        } else {
          setConflict(e.remote);
          setSyncStatus("Conflict");
        }
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
      // Keep persisted active simulation and active slot preferences in sync with staged working edits when scenarios exist
      const hasSavedScenarios = Boolean(
        current.state.filters[rosterScenariosKey] &&
          !saved.issue &&
          (saved.collection.scenarios.length > 0 ||
            (saved.collection.snapshots &&
              saved.collection.snapshots.length > 0)),
      );
      const activeChanged =
        !saved.issue &&
        saved.collection.active !== read.collection.active &&
        (!read.collection.active ||
          saved.collection.scenarios.some(
            (scenario) => scenario.id === read.collection.active,
          ));
      const activeSlotChanged =
        hasSavedScenarios &&
        read.collection.activeSlot !== undefined &&
        saved.collection.activeSlot !== read.collection.activeSlot;
      if (activeChanged || activeSlotChanged) {
        updateState({
          filters: {
            ...current.state.filters,
            [rosterScenariosKey]: writeRosterScenarios(current.state, {
              ...saved.collection,
              ...(activeChanged ? { active: read.collection.active } : {}),
              ...(activeSlotChanged
                ? { activeSlot: read.collection.activeSlot }
                : {}),
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
      feedback(actionCue(true), feel);
      return true;
    } catch (error) {
      feedback(actionCue(false), feel);
      setError(
        error instanceof Error
          ? error.message
          : "Could not save roster snapshot.",
      );
      return false;
    }
  }
  // Clearing a slot removes all edits, resets back to the live baseline, and deletes the checkpoint.
  function clearScenarioSlot(slot: RosterSaveSlot) {
    const current = wRef.current;
    if (!current) return false;
    try {
      const next = clearRosterSlot(
        current.state,
        rosterDraftRef.current ??
          current.state.filters[rosterScenariosKey] ??
          "",
        slot,
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
          : "Could not clear roster slot.",
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
      // Identify the designated active slot from settings (defaulting to slot 1)
      const targetSlot = (read.collection.activeSlot ?? 1) as RosterSaveSlot;
      const collection = {
        ...read.collection,
        active: next.id,
        activeSlot: targetSlot,
        scenarios: selected
          ? read.collection.scenarios.map((s) => (s.id === next.id ? next : s))
          : [...read.collection.scenarios, next],
      };
      const raw = writeRosterScenarios(current.state, collection);
      // Auto-save the trade directly to the designated active slot
      const saved = saveRosterSnapshot(
        current.state,
        raw,
        targetSlot,
        new Date().toISOString(),
        scenarioRosterBase(realModel),
      );
      updateState({
        filters: { ...current.state.filters, [rosterScenariosKey]: saved.saved },
        draft: { ...draft, give: [], get: [] },
      });
      rosterDraftRef.current = saved.working;
      setRosterDraft(saved.working);
      setError("");
      feedback(actionCue(true), feel);
      // Return success along with the targeted slot so calling views know exactly which slot was updated
      return { ok: true, slot: targetSlot };
    } catch (error) {
      feedback(actionCue(false), feel);
      setError(
        error instanceof Error
          ? error.message
          : "Could not apply hypothetical trade.",
      );
      return false;
    }
  }
  // Apply a cut and an add as one pair of undoable moves in the active hypothetical roster, creating one if needed.
  function trySimulationMoves(team: string, moves: ScenarioMove[]) {
    const current = wRef.current;
    if (!current?.dataset || !realModel) return false;
    try {
      if (realModel.dataset.hash !== current.dataset.hash)
        throw Error(
          "Wait for the current import to finish before applying a hypothetical move.",
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
        name: "Add and drop scenario",
        team,
        season: num(current.dataset.tables.ModelContext[0].Season),
        sourceHash: current.dataset.hash,
        moves: [],
        cursor: 0,
      };
      const base: RosterScenario = {
        ...scenario,
        baseLineups:
          scenario.baseLineups ??
          current.state.filters[starterLineupsKey] ??
          "",
        baseRoster: scenario.baseRoster ?? scenarioRosterBase(realModel),
      };
      const next = moves.reduce<RosterScenario>(
        (s, move) => appendScenarioMove(s, move),
        base,
      );
      // The simulator reports any ownership problem; refuse to save a pair it cannot apply.
      const check = applyRosterScenario(
        realModel,
        next,
        current.state.filters[starterLineupsKey],
      );
      if (check.simulation?.issues.length)
        throw Error(check.simulation.issues.join(" "));
      const targetSlot = (read.collection.activeSlot ?? 1) as RosterSaveSlot;
      const collection = {
        ...read.collection,
        active: next.id,
        activeSlot: targetSlot,
        scenarios: selected
          ? read.collection.scenarios.map((s) => (s.id === next.id ? next : s))
          : [...read.collection.scenarios, next],
      };
      const raw = writeRosterScenarios(current.state, collection);
      const saved = saveRosterSnapshot(
        current.state,
        raw,
        targetSlot,
        new Date().toISOString(),
        scenarioRosterBase(realModel),
      );
      updateState({
        filters: {
          ...current.state.filters,
          [rosterScenariosKey]: saved.saved,
        },
      });
      rosterDraftRef.current = saved.working;
      setRosterDraft(saved.working);
      setError("");
      feedback(actionCue(true), feel);
      return true;
    } catch (error) {
      feedback(actionCue(false), feel);
      setError(
        error instanceof Error
          ? error.message
          : "Could not apply the hypothetical move.",
      );
      return false;
    }
  }
  // Apply a suggested drop directly to the active simulation
  function applySimulationDrop(team: string, playerId: string) {
    const current = wRef.current;
    if (!current?.dataset || !realModel) return false;
    try {
      const read = readRosterScenarios(
        rosterDraftRef.current ?? current.state.filters[rosterScenariosKey],
      );
      if (read.issue) throw Error(read.issue);
      const selected = read.collection.scenarios.find(
        (s) => s.id === read.collection.active,
      );
      if (!selected) return false;
      const next = appendScenarioMove(selected, {
        kind: "move",
        player: playerId,
        from: team,
        to: "0",
      });
      const targetSlot = (read.collection.activeSlot ?? 1) as RosterSaveSlot;
      const collection = {
        ...read.collection,
        active: next.id,
        activeSlot: targetSlot,
        scenarios: selected
          ? read.collection.scenarios.map((s) => (s.id === next.id ? next : s))
          : [...read.collection.scenarios, next],
      };
      const raw = writeRosterScenarios(current.state, collection);
      const saved = saveRosterSnapshot(
        current.state,
        raw,
        targetSlot,
        new Date().toISOString(),
        scenarioRosterBase(realModel),
      );
      updateState({
        filters: {
          ...current.state.filters,
          [rosterScenariosKey]: saved.saved,
        },
      });
      rosterDraftRef.current = saved.working;
      setRosterDraft(saved.working);
      setError("");
      feedback("success", feel);
      return true;
    } catch (error) {
      feedback("caution", feel);
      setError(
        error instanceof Error
          ? error.message
          : "Could not apply suggested drop.",
      );
      return false;
    }
  }
  // Clear the active simulation and return to the live roster
  function switchToLiveRoster() {
    const current = wRef.current;
    if (!current) return;
    try {
      const read = readRosterScenarios(
        rosterDraftRef.current ?? current.state.filters[rosterScenariosKey],
      );
      if (!read.issue) {
        const collection = {
          ...read.collection,
          active: "",
          activeSlot: undefined,
        };
        const raw = writeRosterScenarios(current.state, collection);
        updateState({
          filters: {
            ...current.state.filters,
            [rosterScenariosKey]: raw,
          },
        });
      } else {
        updateState({
          filters: {
            ...current.state.filters,
            [rosterScenariosKey]: "",
          },
        });
      }
      rosterDraftRef.current = null;
      setRosterDraft(null);
      setError("");
      feedback("select", feel);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not switch to live roster.",
      );
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
      feedback("caution", feel);
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
    const owner = data.session?.user.id ?? current?.owner ?? "local";
    feedback(importCue(preview.dataset.issues.length), feel);
    // Keep a small summary of the dataset being replaced so the next screen can show what changed; it is not the workbook.
    if (
      realModel &&
      current?.dataset &&
      realModel.dataset.hash === current.dataset.hash &&
      dataset.hash !== current.dataset.hash
    )
      await writePreviousSummary(owner, summarizeImport(realModel));
    commit({
      dataset,
      state,
      owner,
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
    if (owner) await remove(owner, false);
    commit(null);
    setModel(null);
    setConflict(undefined);
  }
  const d = w?.dataset,
    currentTeam = d?.tables.ModelTeams.find(
      (t) => str(t.TeamID) === w?.state.preferredTeam,
    ),
    // The six section routes, and the earlier addresses, map to the screens below.
    page = pageForRoute(route);
  // The account and import controls, shown on Data & account and on the Lab's Data and account page.
  const accountView = (
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
          const { error } = await client.rpc("delete_fantasy_workspace");
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
  );
  // The Lab splits Model & audit into pages; each needs an imported dataset and the unsimulated model.
  const labReady = !!(model && w && realModel);
  const labSettings = labReady ? (
    <>
      {/* This explicit account-synced selector is separate from browsing opponents. */}
      <section className="gd-card" style={{ marginBottom: "20px" }}>
        <h3 className="gd-settings-group-title" style={{ marginBottom: "12px" }}>
          My team
        </h3>
        <label className="gd-edit-control">
          <span className="gd-edit-label">My team</span>
          <select
            className="gd-edit-input"
            aria-label="My team"
            value={w!.state.preferredTeam}
            onChange={(event) =>
              updateState(
                selectMyTeam(wRef.current!.state, d!, event.target.value),
              )
            }
          >
            {d!.tables.ModelTeams.map((team) => (
              <option key={str(team.TeamID)} value={str(team.TeamID)}>
                {str(team.TeamName)}
              </option>
            ))}
          </select>
        </label>
      </section>
      {/* Build details identify the installed app when diagnosing updates across devices. */}
      <section className="gd-card" style={{ marginBottom: "20px" }}>
        <h3 className="gd-settings-group-title" style={{ marginBottom: "12px" }}>
          App version
        </h3>
        <p>
          Fantasy Football Lab v{appRelease.version} · Build {appRelease.build}{" "}
          · Commit {appRelease.commit}
        </p>
        <p className="gd-muted">
          Built{" "}
          <time dateTime={appRelease.builtAt}>
            {new Date(appRelease.builtAt).toLocaleString()}
          </time>
          . App version is separate from your imported workbook and model
          versions.
        </p>
      </section>
      <ModelView
        part="settings"
        m={realModel!}
        change={(settings) => updateState({ settings })}
      />
    </>
  ) : null;
  const labEvidence = labReady ? (
    <EvidenceSettings
      m={realModel!}
      filters={w!.state.filters}
      change={(patch) =>
        updateState({ filters: { ...w!.state.filters, ...patch } })
      }
    />
  ) : null;
  const labAudits = labReady ? (
    <ModelView
      part="audits"
      m={realModel!}
      change={(settings) => updateState({ settings })}
    />
  ) : null;
  // The simulator is shared by This week and Roster so both edit the same saved roster slots.
  const simulator =
    w && realModel && model ? (
      <RosterSimulator
        real={realModel}
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
        clearSlot={clearScenarioSlot}
        deleteScenario={deleteScenario}
      />
    ) : null;
  // One settings object feeds the header, the Lab and the feedback cues, so they can never disagree.
  const feel = {
    theme: readThemePref(feelFilters[themeKey]),
    animation: readAnimationPref(feelFilters[animationKey]),
    sound: readFlag(feelFilters[soundKey]),
    haptics: readFlag(feelFilters[hapticsKey]),
    hapticsSupported: hapticsSupported(),
  };
  // Merge only the changed Feel key against the latest workspace, preserving unrelated filters; without one, keep it on this device.
  const changeFeelSetting = (
    key: "theme" | "animation" | "sound" | "haptics",
    value: string,
  ) => {
    const [filterKey, stored] = feelEntry(key, value);
    if (wRef.current)
      updateState({
        filters: {
          ...wRef.current.state.filters,
          [filterKey]: stored,
        },
      });
    else {
      const next = { ...localFeel, [filterKey]: stored };
      setLocalFeel(next);
      writeLocalFeel(next);
    }
  };
  const content = (
    <div
      className={`app-shell gd-shell${page === "trades" ? " trade-page" : ""}${["players", "gems", "weekly", "roster", "teams", "overview", "trades", "journal", "lab"].includes(page) ? " gd-new-screen" : ""}`}
    >
      <GamedayHeader
        route={route}
        model={realModel}
        sourceUTC={d ? (d.sourceUTC ?? null) : undefined}
        week={d ? num(d.tables.ModelContext[0].CurrentWeek) : null}
        finalWeek={d ? num(d.tables.ModelContext[0].FinalWeek) : null}
        syncStatus={syncStatus}
        simulation={model?.simulation ?? null}
        hypothetical={model?.simulation?.scenario.name ?? null}
        busy={busy}
        onImport={() => fileRef.current?.click()}
        feel={feel}
        changeFeel={changeFeelSetting}
        onApplyDrop={applySimulationDrop}
        onSwitchToLive={switchToLiveRoster}
      />

      {/* Active labels sit under the header on every screen; phones also get a bottom bar. */}
      <BottomBar route={route} />
      <SignalsTicker m={model} team={w?.state.preferredTeam ?? ""} />
      <main>
        <div className="content">
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
          {/* Show the selected forecast mode without repeatedly interrupting the user with a warning. */}
          {model && model.roleScenarioWeight > 0 && (
            <FilterHelp
              label="Role forecast scenario"
              help={`${Math.round(model.roleScenarioWeight * 100)}% role forecast and ${Math.round((1 - model.roleScenarioWeight) * 100)}% original scoring forecast where role data is available. Change this in Model & audit.`}
            >
              <small>
                Role forecast scenario:{" "}
                {Math.round(model.roleScenarioWeight * 100)}%
              </small>
            </FilterHelp>
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
              <Skeleton width={140} height={12} /> Calculating the current
              snapshot…
            </div>
          )}
          {!ready ? (
            <p>Opening your workspace…</p>
          ) : !d && !preview && page !== "lab" ? (
            <GamedayWelcome onImport={() => fileRef.current?.click()} />
          ) : model && w ? (
            <>
              {page === "roster" && (
                <Roster
                  m={model}
                  team={w.state.preferredTeam}
                  grades={analysisGrades.get(w.state.preferredTeam) ?? []}
                  filters={w.state.filters}
                  onFilters={(patch) =>
                    updateState({
                      filters: { ...wRef.current!.state.filters, ...patch },
                    })
                  }
                  simulator={simulator}
                  tryPair={(moves) =>
                    trySimulationMoves(w.state.preferredTeam, moves)
                  }
                  onApplyDrop={applySimulationDrop}
                  onSwitchToLive={switchToLiveRoster}
                />
              )}
              {page === "teams" && (
                // The grade grid replaces the team page; the full team detail stays below it.
                <League
                  m={model}
                  grades={analysisGrades}
                  mine={w.state.preferredTeam}
                  team={w.state.filters.browsedTeam || w.state.preferredTeam}
                  change={(browsedTeam) =>
                    updateState({
                      filters: { ...wRef.current!.state.filters, browsedTeam },
                    })
                  }
                />
              )}
              {page === "overview" && (
                <Week
                  m={model}
                  team={w.state.preferredTeam}
                  teamName={str(currentTeam?.TeamName)}
                  grades={analysisGrades.get(w.state.preferredTeam) ?? []}
                  draft={w.state.draft}
                  basis={w.state.filters[lineupBasisKey]}
                  digest={digest}
                  onApplyDrop={applySimulationDrop}
                  onSwitchToLive={switchToLiveRoster}
                />
              )}
              {["players", "gems", "weekly"].includes(page) && (
                // One explorer replaces Players, the Gem screener and Weekly streamers.
                <Scouting
                  key={w.owner}
                  tracking={
                    gemTracking.current?.owner === w.owner &&
                    gemTracking.current.hash === realModel?.dataset.hash
                      ? gemTracking.current.result
                      : null
                  }
                  m={model}
                  filters={w.state.filters}
                  onFilters={(patch) =>
                    updateState({
                      filters: { ...wRef.current!.state.filters, ...patch },
                    })
                  }
                />
              )}
              {page === "trades" && (
                <TradeRoom
                  key={w.owner}
                  m={model}
                  draft={w.state.draft}
                  state={w.state}
                  lineupsRaw={
                    model.simulation?.lineupsRaw ??
                    w.state.filters[starterLineupsKey]
                  }
                  basisRaw={w.state.filters[lineupBasisKey]}
                  tab={readTradeTab(w.state.filters[tradeTabKey])}
                  // Remember the selected tool against the latest workspace, preserving unrelated filters.
                  setTab={(tab) =>
                    updateState({
                      filters: {
                        ...wRef.current!.state.filters,
                        [tradeTabKey]: tab,
                      },
                    })
                  }
                  change={(draft) =>
                    updateState({
                      ...selectMyTeam(wRef.current!.state, d!, draft.teamA),
                      draft,
                    })
                  }
                  changeBasis={(basis) =>
                    updateState({
                      filters: {
                        ...wRef.current!.state.filters,
                        [lineupBasisKey]: basis,
                      },
                    })
                  }
                  forceTrade={forceScenarioTrade}
                  restoreScenario={restoreScenario}
                  filters={w.state.filters}
                  onFilters={(patch) =>
                    updateState({
                      filters: {
                        ...wRef.current!.state.filters,
                        ...patch,
                      },
                    })
                  }
                  onApplyDrop={applySimulationDrop}
                  onSwitchToLive={switchToLiveRoster}
                />
              )}
              {page === "journal" && (
                // The journal keeps its behaviour; the new theme is applied around it.
                <div className="legacy">
                  <TradeJournal m={model} ownTeam={w.state.preferredTeam} />
                </div>
              )}
            </>
          ) : null}
          {page === "lab" && (
            <Lab
              tab={labTabForRoute(route)}
              settings={labSettings}
              evidence={labEvidence}
              audits={labAudits}
              account={accountView}
              feel={feel}
              changeFeel={changeFeelSetting}
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
  return (
    <NegotiationsProvider
      key={w?.owner ?? "local"}
      owner={w?.owner ?? "local"}
      client={client}
    >
      <FeedbackProvider settings={feel}>
        <RouteFeedback route={route} />
        <PopoverProvider>
        {/* The single player card replaces the anchored popover and the player page. */}
        <PlayerCardProvider
          m={model}
          lastTab={readCardTab(w?.state.filters[cardTabKey])}
          versusRaw={w?.state.filters.versusIds ?? ""}
          // Remember the comparison pair against the latest workspace, preserving unrelated filters.
          saveVersus={(raw) => {
            if (wRef.current)
              updateState({
                filters: { ...wRef.current.state.filters, versusIds: raw },
              });
          }}
          // Remember the last tab against the latest workspace, preserving unrelated filters.
          saveTab={(tab) => {
            if (wRef.current)
              updateState({
                filters: { ...wRef.current.state.filters, [cardTabKey]: tab },
              });
          }}
        >
          <PlayerRouteOpener route={route} ready={!!model} />
          {content}
          {/* Popovers render here so player links inside them open the card above them. */}
          <PopoverLayer />
        </PlayerCardProvider>
      </PopoverProvider>
      </FeedbackProvider>
    </NegotiationsProvider>
  );
}
