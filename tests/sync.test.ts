import { it, expect, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  cloudClient,
  signOutFantasy,
  sync,
  Conflict,
  acknowledgeSync,
} from "../src/sync/client";
import { initialState, type Workspace } from "../src/domain/contracts";
import { fixture } from "./fixtures";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

it("uses an app-specific, project-specific session store", () => {
  cloudClient({ url: "https://sharedproject.supabase.co", key: "public-key" });
  expect(createClient).toHaveBeenLastCalledWith(
    "https://sharedproject.supabase.co",
    "public-key",
    {
      auth: {
        storageKey: "fantasy-lab-sharedproject.supabase.co-auth",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
});

it("revokes only Fantasy's session and reports sign-out failures", async () => {
  const signOut = vi.fn().mockResolvedValue({ error: null });
  const client = { auth: { signOut } } as unknown as SupabaseClient;
  await signOutFantasy(client);
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  signOut.mockResolvedValue({ error: new Error("offline") });
  await expect(signOutFantasy(client)).rejects.toThrow("offline");
});

// Synthetic cloud rows implement the deployed revision/request-ID contract without network access or real account data.
async function syncFixture(withDataset = false) {
  const dataset = await fixture();
  const workspace: Workspace = {
    owner: "synthetic-account",
    dataset: withDataset ? dataset : null,
    state: initialState(dataset),
    datasetRevision: 2,
    stateRevision: 3,
    pendingDataset: false,
    pendingState: true,
    requestId: crypto.randomUUID(),
    stateRequestId: crypto.randomUUID(),
  };
  const row = {
    dataset: workspace.dataset,
    state: structuredClone(workspace.state),
    dataset_revision: 2,
    state_revision: 3,
    last_dataset_request_id: null as string | null,
    last_state_request_id: null as string | null,
  };
  const rpc = vi.fn(async (name: string, args?: Record<string, any>) => {
    if (name === "get_fantasy_workspace")
      return { data: [structuredClone(row)], error: null };
    if (name === "replace_fantasy_dataset") {
      if (row.last_dataset_request_id !== args!.p_request_id) {
        if (row.dataset_revision !== args!.p_expected_revision)
          return { data: null, error: { message: "CONFLICT_DATASET" } };
        row.dataset = args!.p_dataset;
        row.dataset_revision++;
        row.last_dataset_request_id = args!.p_request_id;
      }
    } else if (name === "update_fantasy_state") {
      if (row.last_state_request_id !== args!.p_request_id) {
        if (
          row.state_revision !== args!.p_expected_revision ||
          row.dataset_revision !== args!.p_dataset_revision
        )
          return { data: null, error: { message: "CONFLICT_STATE" } };
        row.state = structuredClone(args!.p_state);
        row.state_revision++;
        row.last_state_request_id = args!.p_request_id;
      }
    } else throw Error(`Unexpected RPC ${name}`);
    return { data: structuredClone(row), error: null };
  });
  return {
    workspace,
    dataset,
    row,
    rpc,
    client: { rpc } as unknown as SupabaseClient,
  };
}

// Both the first upload and the next sync must succeed when a newer local edit arrives during the first request.
it("acknowledges an in-flight upload while retaining newer local state", async () => {
  const { workspace, client, row } = await syncFixture();
  const newer: Workspace = {
    ...workspace,
    state: { ...workspace.state, filters: { test: "newer edit" } },
    stateRequestId: crypto.randomUUID(),
  };
  const acknowledged = acknowledgeSync(
    newer,
    workspace,
    await sync(client, workspace),
  )!;
  expect(acknowledged.state).toEqual(newer.state);
  expect(acknowledged.stateRevision).toBe(4);
  expect(acknowledged.pendingState).toBe(true);
  expect(acknowledged.stateRequestId).toBe(newer.stateRequestId);
  const next = await sync(client, acknowledged);
  expect(next.pendingState).toBe(false);
  expect(next.stateRevision).toBe(5);
  expect(row.state.filters).toEqual({ test: "newer edit" });
});

// Reimporting while an older dataset uploads must retain the new import and use the acknowledged base for its retry.
it("preserves a newer import and its settings while acknowledging an older upload", async () => {
  const { workspace, dataset, client } = await syncFixture(true);
  workspace.pendingDataset = true;
  const newer: Workspace = {
    ...workspace,
    dataset: {
      ...dataset,
      importedAt: new Date(Date.now() + 1000).toISOString(),
    },
    requestId: crypto.randomUUID(),
    state: { ...workspace.state, filters: { test: "new import" } },
    stateRequestId: crypto.randomUUID(),
  };
  const acknowledged = acknowledgeSync(
    newer,
    workspace,
    await sync(client, workspace),
  )!;
  expect(acknowledged.dataset).toBe(newer.dataset);
  expect(acknowledged.state).toBe(newer.state);
  expect(acknowledged.datasetRevision).toBe(3);
  expect(acknowledged.pendingDataset).toBe(true);
  const next = await sync(client, acknowledged);
  expect(next.datasetRevision).toBe(4);
  expect(next.dataset).toEqual(newer.dataset);
  expect(next.pendingDataset).toBe(false);
});

// A network failure after the server commits must not turn its immediately repeated request into a false conflict.
it.each(["state", "dataset"])(
  "recognizes an acknowledged %s request after its response was lost",
  async (kind) => {
    const { workspace, client, row, rpc } = await syncFixture(true);
    workspace.pendingDataset = kind === "dataset";
    workspace.pendingState = kind === "state";
    const operation =
      kind === "dataset" ? "replace_fantasy_dataset" : "update_fantasy_state";
    const implementation = rpc.getMockImplementation()!;
    let loseResponse = true;
    rpc.mockImplementation(async (name, args) => {
      const result = await implementation(name, args);
      if (name === operation && loseResponse) {
        loseResponse = false;
        throw Error("Interrupted after commit");
      }
      return result;
    });
    await expect(sync(client, workspace)).rejects.toThrow(
      "Interrupted after commit",
    );
    const next = await sync(client, workspace);
    expect(next.datasetRevision).toBe(kind === "dataset" ? 3 : 2);
    expect(next.stateRevision).toBe(kind === "state" ? 4 : 3);
    expect(row.dataset_revision).toBe(next.datasetRevision);
    expect(row.state_revision).toBe(next.stateRevision);
    expect(next.pendingDataset || next.pendingState).toBe(false);
  },
);

// Genuine second-device edits and changed dataset bases still require an explicit choice; never overwrite them automatically.
it.each(["state", "dataset"])(
  "retains a genuine remote %s conflict",
  async (kind) => {
    const { workspace, client, row, rpc } = await syncFixture();
    if (kind === "state") row.state_revision++;
    else row.dataset_revision++;
    await expect(sync(client, workspace)).rejects.toBeInstanceOf(Conflict);
    expect(
      rpc.mock.calls.every(([name]) => name === "get_fantasy_workspace"),
    ).toBe(true);
  },
);

// Server-side compare-and-swap must detect a second device that writes after the initial read.
it("returns the current conflicting state when another device wins during the upload", async () => {
  const { workspace, client, row, rpc } = await syncFixture();
  const implementation = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name, args) => {
    if (name === "update_fantasy_state") {
      row.state_revision++;
      row.state.filters = { remote: "keep me" };
    }
    return implementation(name, args);
  });
  try {
    await sync(client, workspace);
    expect.fail("Expected conflict");
  } catch (e) {
    expect(e).toBeInstanceOf(Conflict);
    expect((e as Conflict).remote?.state.filters).toEqual({
      remote: "keep me",
    });
  }
  expect(row.state.filters).toEqual({ remote: "keep me" });
});

// A later cloud read must never mislabel somebody else's commit as our own acknowledged revision.
it("uses the committed response rather than a later cloud pull", async () => {
  const { workspace, client, row, rpc } = await syncFixture();
  const implementation = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name, args) => {
    const result = await implementation(name, args);
    if (name === "update_fantasy_state") {
      row.state_revision++;
      row.state.filters = { remote: "later edit" };
    }
    return result;
  });
  const next = await sync(client, workspace);
  expect(next.stateRevision).toBe(4);
  expect(row.state_revision).toBe(5);
  next.pendingState = true;
  next.stateRequestId = crypto.randomUUID();
  await expect(sync(client, next)).rejects.toBeInstanceOf(Conflict);
});

// A concurrent download cannot silently merge local selections onto a different cloud revision or dataset.
it.each(["state", "dataset"])(
  "does not rebase edits made during a remote %s download",
  async (kind) => {
    const { workspace, client, row } = await syncFixture();
    workspace.pendingState = false;
    const newer: Workspace = {
      ...workspace,
      stateRequestId: crypto.randomUUID(),
      pendingState: true,
      state: { ...workspace.state, filters: { local: "preserve" } },
    };
    if (kind === "state") row.state_revision++;
    else row.dataset_revision++;
    const received = await sync(client, workspace);
    expect(() => acknowledgeSync(newer, workspace, received)).toThrow(Conflict);
    expect(newer.state.filters).toEqual({ local: "preserve" });
  },
);

// Stale requests cannot leak account data or reverse an already completed adoption/deletion.
it("discards acknowledgements after an account or revision switch", async () => {
  const { workspace, client } = await syncFixture();
  const received = await sync(client, workspace);
  expect(acknowledgeSync(null, workspace, received)).toBeNull();
  expect(
    acknowledgeSync(
      { ...workspace, owner: "other-account" },
      workspace,
      received,
    ),
  ).toBeNull();
  expect(
    acknowledgeSync({ ...workspace, stateRevision: 9 }, workspace, received),
  ).toBeNull();
  expect(acknowledgeSync(workspace, workspace, received)).toEqual(received);
});

// Deleted cloud workspaces never resurrect without the user's existing explicit Keep this device action.
it("preserves the explicit choice when the cloud workspace is missing", async () => {
  const { workspace, client, rpc } = await syncFixture();
  rpc.mockResolvedValue({ data: [], error: null });
  await expect(sync(client, workspace)).rejects.toBeInstanceOf(Conflict);
  expect(rpc).toHaveBeenCalledTimes(1);
});

// Dataset uploads must not hide a concurrent settings write behind their draft-reconciliation revision.
it("does not overwrite state changed during dataset replacement", async () => {
  const { workspace, client, row, rpc } = await syncFixture(true);
  workspace.pendingDataset = true;
  const implementation = rpc.getMockImplementation()!;
  rpc.mockImplementation(async (name, args) => {
    if (name === "replace_fantasy_dataset") {
      row.state_revision++;
      row.last_state_request_id = crypto.randomUUID();
      row.state.filters = { remote: "new settings" };
    }
    return implementation(name, args);
  });
  await expect(sync(client, workspace)).rejects.toBeInstanceOf(Conflict);
  expect(row.state.filters).toEqual({ remote: "new settings" });
  expect(rpc.mock.calls.some(([name]) => name === "update_fantasy_state")).toBe(
    false,
  );
});
