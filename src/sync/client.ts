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
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      })
    : null;
}
export class Conflict extends Error {
  constructor(public remote: Workspace | null) {
    super(
      "Another device changed the cloud workspace. Choose which current dataset/state to keep.",
    );
  }
}
export async function pull(
  client: SupabaseClient,
  owner: string,
): Promise<Workspace | null> {
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
  return {
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
}
export async function sync(
  client: SupabaseClient,
  w: Workspace,
  force = false,
): Promise<Workspace> {
  let remote = await pull(client, w.owner);
  if (!remote) {
    if (!force) throw new Conflict(null);
    const { error } = await client.rpc("initialize_fantasy_workspace", {
      p_state: w.state,
    });
    if (error) throw error;
    remote = await pull(client, w.owner);
  }
  if (!remote) throw Error("Cloud initialization failed.");
  const pending = w.pendingDataset || w.pendingState;
  if (!pending) return remote;
  if (
    !force &&
    ((w.pendingDataset && remote.datasetRevision !== w.datasetRevision) ||
      (w.pendingState && remote.stateRevision !== w.stateRevision))
  )
    throw new Conflict(remote);
  let stateRevision = w.stateRevision;
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
    const committed = Array.isArray(data) ? data[0] : data;
    stateRevision = Number(committed.state_revision);
  }
  remote = await pull(client, w.owner);
  if (!remote) throw Error("Cloud workspace was removed.");
  if (w.pendingState) {
    const { error } = await client.rpc("update_fantasy_state", {
      p_expected_revision: force ? remote.stateRevision : stateRevision,
      p_dataset_revision: remote.datasetRevision,
      p_request_id: w.stateRequestId,
      p_state: w.state,
    });
    if (error) {
      if (error.message.includes("CONFLICT")) throw new Conflict(remote);
      throw error;
    }
  }
  return (await pull(client, w.owner))!;
}
