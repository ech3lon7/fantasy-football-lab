import { openDB } from "idb";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  journalEntrySchema,
  sameJournalEntry,
  type JournalEntry,
} from "../domain/trade-journal";

// Keep negotiation history account-scoped in the existing local database, separate from dataset replacement/settings limits.
const prefix = (owner: string) => `negotiations:${owner}:`;
const db = () =>
  openDB("fantasy-football-lab", 1, {
    upgrade(d) {
      d.createObjectStore("current");
    },
  });
export interface NegotiationRecord {
  entry: JournalEntry;
  revision: number;
  dirty: boolean;
  request: string;
}
export async function readNegotiations(
  owner: string,
): Promise<NegotiationRecord[]> {
  const d = await db();
  return (
    await d.getAll(
      "current",
      IDBKeyRange.bound(prefix(owner), `${prefix(owner)}\uffff`),
    )
  ).map((record: NegotiationRecord) => ({
    ...record,
    entry: journalEntrySchema.parse(record.entry),
  }));
}

// Serialize local edits atomically; immutable forecasts can be re-imported identically but cannot be silently rewritten.
export async function putNegotiations(owner: string, entries: JournalEntry[]) {
  const parsed = entries.map((e) => journalEntrySchema.parse(e));
  if (new Set(parsed.map((e) => e.id)).size !== parsed.length)
    throw Error(
      "Duplicate journal IDs in this import. Existing records were preserved.",
    );
  const d = await db(),
    tx = d.transaction("current", "readwrite");
  try {
    if (!(await tx.store.get(owner)))
      throw Error(
        "This workspace is no longer active. Reopen it before saving a journal record.",
      );
    // Bound durable history explicitly; never silently prune offers or predictions to make a write succeed.
    const existing: NegotiationRecord[] = await tx.store.getAll(
      IDBKeyRange.bound(prefix(owner), `${prefix(owner)}\uffff`),
    );
    const proposed = new Map(existing.map((row) => [row.entry.id, row.entry]));
    for (const entry of parsed) proposed.set(entry.id, entry);
    if (
      proposed.size > 10000 ||
      new TextEncoder().encode(JSON.stringify([...proposed.values()])).length >
        50 * 1024 * 1024
    )
      throw Error(
        "Trade journal storage limit reached. Export your journal before adding more history; existing records were preserved.",
      );
    for (const entry of parsed) {
      const key = prefix(owner) + entry.id,
        old: NegotiationRecord | undefined = await tx.store.get(key);
      if (old && sameJournalEntry(old.entry, entry)) continue;
      if (old && (old.entry.kind !== entry.kind || entry.kind === "forecast"))
        throw Error(`Immutable or conflicting journal record: ${entry.id}.`);
      const encoded = JSON.stringify(entry);
      if (new TextEncoder().encode(encoded).length > 512 * 1024)
        throw Error(
          "Journal record is too large; existing history was preserved.",
        );
      await tx.store.put(
        {
          entry,
          revision: old?.revision ?? 0,
          dirty: true,
          request: crypto.randomUUID(),
        } satisfies NegotiationRecord,
        key,
      );
    }
    await tx.done;
  } catch (error) {
    tx.abort();
    await tx.done.catch(() => {});
    throw error;
  }
  window.dispatchEvent(
    new CustomEvent("fantasy-negotiations-changed", { detail: owner }),
  );
}

// Cloud updates acknowledge only the exact local request sent; edits made during a sync remain dirty.
async function adopt(
  owner: string,
  remote: NegotiationRecord,
  sent?: NegotiationRecord,
) {
  const d = await db(),
    tx = d.transaction("current", "readwrite"),
    key = prefix(owner) + remote.entry.id;
  const workspace = await tx.store.get(owner),
    current: NegotiationRecord | undefined = await tx.store.get(key);
  if (
    workspace &&
    (!current || !current.dirty || sent?.request === current.request)
  )
    await tx.store.put(remote, key);
  else if (workspace && sent && current?.revision === sent.revision)
    await tx.store.put({ ...current, revision: remote.revision }, key);
  await tx.done;
}
export interface NegotiationConflict {
  local: NegotiationRecord;
  remote: NegotiationRecord;
}

// Use record-level revision checks instead of replacing the whole journal when a different device edits one offer.
export async function syncNegotiations(
  owner: string,
  client: SupabaseClient,
): Promise<NegotiationConflict[]> {
  const { data, error } = await client.rpc("get_fantasy_negotiations", {
    p_owner: owner,
  });
  if (error)
    throw Error(
      `Trade journal sync: ${error.message}. Your local journal is saved.`,
    );
  const remote = new Map<string, NegotiationRecord>();
  for (const row of data ?? []) {
    const entry = journalEntrySchema.parse({
      id: row.record_id,
      kind: row.kind,
      payload: row.payload,
    });
    remote.set(entry.id, {
      entry,
      revision: Number(row.revision),
      dirty: false,
      request: row.request_id,
    });
  }
  const local = await readNegotiations(owner),
    conflicts: NegotiationConflict[] = [];
  for (const record of local) {
    const cloud = remote.get(record.entry.id);
    remote.delete(record.entry.id);
    if (!record.dirty) {
      if (cloud) await adopt(owner, cloud);
      continue;
    }
    if (cloud && sameJournalEntry(record.entry, cloud.entry)) {
      await adopt(owner, cloud, record);
      continue;
    }
    if (cloud && record.revision !== cloud.revision) {
      conflicts.push({ local: record, remote: cloud });
      continue;
    }
    const { data: saved, error: failure } = await client.rpc(
      "put_fantasy_negotiation",
      {
        p_owner: owner,
        p_id: record.entry.id,
        p_kind: record.entry.kind,
        p_payload: record.entry.payload,
        p_expected_revision: record.revision,
        p_request_id: record.request,
      },
    );
    if (failure)
      throw Error(
        `Trade journal sync: ${failure.message}. Local records remain saved; sync again to inspect concurrent changes.`,
      );
    const row = Array.isArray(saved) ? saved[0] : saved;
    await adopt(
      owner,
      {
        entry: journalEntrySchema.parse({
          id: row.record_id,
          kind: row.kind,
          payload: row.payload,
        }),
        revision: Number(row.revision),
        dirty: false,
        request: row.request_id,
      },
      record,
    );
  }
  for (const record of remote.values()) await adopt(owner, record);
  window.dispatchEvent(
    new CustomEvent("fantasy-negotiations-changed", { detail: owner }),
  );
  return conflicts;
}

// Conflict decisions are explicit per record; neither action can mutate an already stored forecast.
export async function resolveNegotiation(
  owner: string,
  conflict: NegotiationConflict,
  keepLocal: boolean,
) {
  const d = await db(),
    tx = d.transaction("current", "readwrite"),
    key = prefix(owner) + conflict.local.entry.id;
  const current: NegotiationRecord | undefined = await tx.store.get(key);
  if (current?.request !== conflict.local.request) {
    await tx.done;
    throw Error(
      "This record changed after the conflict appeared. Sync again before deciding.",
    );
  }
  // A conflict choice never erases the sole original forecast: retain a linked local copy before adopting the cloud identity.
  if (
    current.entry.kind === "forecast" &&
    !sameJournalEntry(current.entry, conflict.remote.entry)
  ) {
    const copy = {
      ...current.entry,
      id: crypto.randomUUID(),
      payload: { ...current.entry.payload, preservedFrom: current.entry.id },
    };
    await tx.store.put(
      { entry: copy, revision: 0, dirty: true, request: crypto.randomUUID() },
      prefix(owner) + copy.id,
    );
    await tx.store.put(conflict.remote, key);
    await tx.done;
    window.dispatchEvent(
      new CustomEvent("fantasy-negotiations-changed", { detail: owner }),
    );
    return;
  }
  await tx.store.put(
    keepLocal
      ? {
          ...current,
          revision: conflict.remote.revision,
          dirty: true,
          request: crypto.randomUUID(),
        }
      : conflict.remote,
    key,
  );
  await tx.done;
  window.dispatchEvent(
    new CustomEvent("fantasy-negotiations-changed", { detail: owner }),
  );
}
