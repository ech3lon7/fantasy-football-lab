import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  datasetSchema,
  stateSchema,
  type Workspace,
} from "../domain/contracts";
import { contentHash, validateSources } from "../import/workbook";
export interface CloudConfig {
  url: string;
  key: string;
}
const key = "fantasy-lab-cloud-config";
export function getConfig(): CloudConfig {
  try {
    return (
      JSON.parse(localStorage.getItem(key) ?? "null") ?? {
        url: import.meta.env.VITE_SUPABASE_URL ?? "",
        key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      }
    );
  } catch {
    return { url: "", key: "" };
  }
}
export function putConfig(c: CloudConfig) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(c.url))
    throw Error("Use your Supabase HTTPS project URL.");
  if (!(c.key.startsWith("sb_publishable_") || c.key.startsWith("eyJ")))
    throw Error("Use a publishable or legacy anon key, never a secret key.");
  if (c.key.startsWith("eyJ")) {
    try {
      const claims = JSON.parse(atob(c.key.split(".")[1]));
      if (claims.role !== "anon") throw Error();
    } catch {
      throw Error("This is not an anon key. Do not use an administrative key.");
    }
  }
  localStorage.setItem(key, JSON.stringify(c));
}
export function cloudClient(c: CloudConfig): SupabaseClient | null {
  return c.url && c.key
    ? createClient(c.url, c.key, {
        auth: {
          // GitHub Pages apps share an origin; keep Fantasy's session separate.
          storageKey: `fantasy-lab-${new URL(c.url).hostname}-auth`,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
}
export async function signOutFantasy(client: SupabaseClient) {
  // The default global scope would also revoke Trainwise's sessions.
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
}
export class Conflict extends Error {
  constructor(public remote: Workspace | null) {
    super(
      "Another device changed the cloud workspace. Choose which current dataset/state to keep.",
    );
  }
}
// Keep server request acknowledgements internal; local workspaces retain the existing storage schema.
interface CloudSnapshot {
  workspace: Workspace;
  datasetRequestId: string | null;
  stateRequestId: string | null;
}
async function readCloud(
  client: SupabaseClient,
  owner: string,
): Promise<CloudSnapshot | null> {
  const { data, error } = await client.rpc("get_fantasy_workspace");
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  const dataset = row.dataset ? datasetSchema.parse(row.dataset) : null;
  if (dataset) {
    validateSources(dataset);
    if ((await contentHash(dataset.tables, dataset.settings)) !== dataset.hash)
      throw Error("Cloud dataset integrity check failed.");
  }
  const workspace: Workspace = {
    owner,
    dataset,
    state: stateSchema.parse(row.state),
    datasetRevision: Number(row.dataset_revision),
    stateRevision: Number(row.state_revision),
    pendingDataset: false,
    pendingState: false,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  return {
    workspace,
    datasetRequestId: row.last_dataset_request_id ?? null,
    stateRequestId: row.last_state_request_id ?? null,
  };
}
export async function pull(
  client: SupabaseClient,
  owner: string,
): Promise<Workspace | null> {
  return (await readCloud(client, owner))?.workspace ?? null;
}

// Adopt successful revisions without dropping edits made locally while the request was in flight.
export function acknowledgeSync(
  current: Workspace | null,
  sent: Workspace,
  received: Workspace,
): Workspace | null {
  if (!current || current.owner !== sent.owner || received.owner !== sent.owner)
    return null;
  // A different adoption/deletion already changed this account's base; discard this obsolete response.
  if (
    current.datasetRevision !== sent.datasetRevision ||
    current.stateRevision !== sent.stateRevision
  )
    return null;
  const datasetChanged = current.requestId !== sent.requestId;
  const stateChanged = current.stateRequestId !== sent.stateRequestId;
  // A download cannot silently rebase newer local edits onto another device's changed workspace.
  if (
    (!sent.pendingDataset &&
      current.pendingState &&
      stateChanged &&
      received.datasetRevision !== sent.datasetRevision) ||
    (!sent.pendingDataset &&
      current.pendingDataset &&
      datasetChanged &&
      received.datasetRevision !== sent.datasetRevision) ||
    (!sent.pendingState &&
      current.pendingState &&
      stateChanged &&
      received.stateRevision !== sent.stateRevision)
  )
    throw new Conflict(received);
  return {
    ...received,
    ...(datasetChanged
      ? {
          dataset: current.dataset,
          requestId: current.requestId,
          pendingDataset: current.pendingDataset,
        }
      : {}),
    ...(stateChanged
      ? {
          state: current.state,
          stateRequestId: current.stateRequestId,
          pendingState: current.pendingState,
        }
      : {}),
  };
}
export async function sync(
  client: SupabaseClient,
  w: Workspace,
  force = false,
): Promise<Workspace> {
  let snapshot = await readCloud(client, w.owner);
  if (!snapshot) {
    if (!force) throw new Conflict(null);
    const { error } = await client.rpc("initialize_fantasy_workspace", {
      p_state: w.state,
    });
    if (error) throw error;
    snapshot = await readCloud(client, w.owner);
  }
  if (!snapshot) throw Error("Cloud initialization failed.");
  const remote = snapshot.workspace;
  if (!(w.pendingDataset || w.pendingState)) return remote;
  // Immediately retrying an acknowledged request is safe: the RPC also verifies its identical payload.
  const datasetRetried = snapshot.datasetRequestId === w.requestId;
  const stateRetried = snapshot.stateRequestId === w.stateRequestId;
  if (
    !force &&
    ((w.pendingDataset &&
      remote.datasetRevision !== w.datasetRevision &&
      !datasetRetried) ||
      (w.pendingState &&
        remote.stateRevision !== w.stateRevision &&
        !stateRetried) ||
      (!w.pendingDataset &&
        w.pendingState &&
        remote.datasetRevision !== w.datasetRevision))
  )
    throw new Conflict(remote);
  let committed = remote;
  if (w.pendingDataset) {
    const { data, error } = await client.rpc("replace_fantasy_dataset", {
      p_expected_revision: force ? remote.datasetRevision : w.datasetRevision,
      p_request_id: w.requestId,
      p_dataset: w.dataset,
    });
    if (error) {
      if (error.message.includes("CONFLICT"))
        throw new Conflict(await pull(client, w.owner));
      throw error;
    }
    // Use the write's own returned row, never a later pull that could acknowledge somebody else's edits.
    const row = Array.isArray(data) ? data[0] : data;
    committed = {
      ...remote,
      dataset: w.dataset,
      state: stateSchema.parse(row.state),
      datasetRevision: Number(row.dataset_revision),
      stateRevision: Number(row.state_revision),
    };
    // Dataset replacement can reconcile draft IDs; a separate concurrent state write still needs a choice.
    if (
      w.pendingState &&
      (row.last_state_request_id ?? null) !== snapshot.stateRequestId &&
      row.last_state_request_id !== w.stateRequestId
    )
      throw new Conflict(await pull(client, w.owner));
  }
  if (w.pendingState) {
    const { data, error } = await client.rpc("update_fantasy_state", {
      p_expected_revision: committed.stateRevision,
      p_dataset_revision: committed.datasetRevision,
      p_request_id: w.stateRequestId,
      p_state: w.state,
    });
    if (error) {
      if (error.message.includes("CONFLICT"))
        throw new Conflict(await pull(client, w.owner));
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    committed = {
      ...committed,
      state: stateSchema.parse(row.state),
      datasetRevision: Number(row.dataset_revision),
      stateRevision: Number(row.state_revision),
    };
  }
  return committed;
}
