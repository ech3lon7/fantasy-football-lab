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
} from "../domain/contracts";
import type { Model } from "../domain/valuation";
import type { PositionGrade } from "../domain/lineups";
import { load, save, remove } from "../storage/workspace";
import {
  getConfig,
  putConfig,
  cloudClient,
  signOutFantasy,
  pull,
  sync,
  Conflict,
  type CloudConfig,
} from "../sync/client";
import { Legend } from "../ui/components";
import { Panel } from "../ui/layout";
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
    [model, setModel] = useState<Model | null>(null),
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
    syncBusy = useRef(false);
  function commit(next: Workspace | null) {
    wRef.current = next;
    setW(next);
    if (next)
      saveQueue.current = saveQueue.current
        .then(() => save(next))
        .catch((e) => setError(`Could not save locally: ${e.message}`));
  }
  useEffect(() => {
    const notify = () => setUpdateReady(true);
    window.addEventListener("fantasy-update-ready", notify);
    return () => window.removeEventListener("fantasy-update-ready", notify);
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
    });
    return () => worker.terminate();
  }, [w?.dataset?.hash, JSON.stringify(w?.state.settings)]);
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
      if (wRef.current !== current) {
        setSyncStatus("Changes pending; sync again");
        return;
      }
      commit(next);
      setConflict(undefined);
      setSyncStatus("Synced");
    } catch (e) {
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
                    str(p.OnTeamID) === current.state.draft.teamA,
                ),
              ),
              get: current.state.draft.get.filter((id) =>
                dataset.tables.ModelPlayers.some(
                  (p) =>
                    str(p.PlayerID) === id &&
                    str(p.OnTeamID) === current.state.draft.teamB,
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
  return (
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
                  const reg = await navigator.serviceWorker.getRegistration();
                  navigator.serviceWorker.addEventListener(
                    "controllerchange",
                    () => location.reload(),
                    { once: true },
                  );
                  reg?.waiting?.postMessage("SKIP_WAITING");
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
                      setSyncStatus("Synced");
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
                <Overview
                  m={model}
                  grades={grades.get(w.state.preferredTeam) ?? []}
                  team={w.state.preferredTeam}
                />
              )}
              {page === "teams" && (
                <TeamView
                  m={model}
                  grades={grades}
                  team={w.state.preferredTeam}
                  change={(preferredTeam) => updateState({ preferredTeam })}
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
                  m={model}
                  filters={w.state.filters}
                  onFilters={(patch) =>
                    updateState({ filters: { ...w.state.filters, ...patch } })
                  }
                />
              )}
              {page === "weekly" && <Weekly m={model} />}
              {page === "trades" && (
                <TradeView
                  m={model}
                  draft={w.state.draft}
                  change={(draft) => updateState({ draft })}
                />
              )}
              {page === "model" && (
                <ModelView
                  m={model}
                  change={(settings) => updateState({ settings })}
                />
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
            <span>Adaptive model · provisional assumptions · v0.1.0</span>
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
}
