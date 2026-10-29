import { openDB } from "idb";
import {
  advanceGemJournal,
  emptyGemJournal,
  gemJournalSchema,
  type GemTrackingState,
} from "../domain/gem-tracking";
import type { Model } from "../domain/valuation";
import {
  datasetSchema,
  stateSchema,
  type Workspace,
} from "../domain/contracts";
const db = () =>
  openDB("fantasy-football-lab", 1, {
    upgrade(d) {
      d.createObjectStore("current");
    },
  });
export async function load(owner = "local"): Promise<Workspace | null> {
  const d = await db(),
    w = await d.get("current", owner);
  if (!w) return null;
  return {
    ...w,
    dataset: w.dataset ? datasetSchema.parse(w.dataset) : null,
    state: stateSchema.parse(w.state),
  };
}
export async function save(w: Workspace) {
  const d = await db();
  await d.put("current", w, w.owner);
}
export async function remove(owner: string, eraseNegotiations = true) {
  const d = await db();
  // Clear the private account journal with its workspace, including sign-out and existing clear-account flows.
  const tx = d.transaction("current", "readwrite");
  await tx.store.delete(owner);
  await tx.store.delete(`gem-tracking:${owner}`);
  // Explicit deletion includes private journal history; sign-out can retain account-scoped unsynced originals.
  if (eraseNegotiations)
    await tx.store.delete(
      IDBKeyRange.bound(
        `negotiations:${owner}:`,
        `negotiations:${owner}:\uffff`,
      ),
    );
  await tx.done;
}

// A separate account-scoped record keeps prospective history out of the 64 KB synced settings and current dataset.
export async function observeGemTracking(
  owner: string,
  model: Model,
): Promise<GemTrackingState> {
  const d = await db(),
    tx = d.transaction("current", "readwrite");
  const workspace = (await tx.store.get(owner)) as Workspace | undefined;
  const raw: unknown = await tx.store.get(`gem-tracking:${owner}`);
  // A delayed worker must never recreate history after account deletion or record an obsolete imported dataset.
  if (!workspace || workspace.dataset?.hash !== model.dataset.hash) {
    await tx.done;
    return {
      journal: emptyGemJournal(),
      status: "Waiting for the current workspace to finish saving.",
    };
  }
  const parsed = gemJournalSchema.safeParse(
    raw === undefined ? emptyGemJournal() : raw,
  );
  if (!parsed.success) {
    await tx.done;
    return {
      journal: emptyGemJournal(),
      status:
        "Saved Gem tracking is unreadable or from an unsupported version. It has been preserved without overwriting; live labels are unaffected.",
    };
  }
  const result = advanceGemJournal(parsed.data, model);
  // Bound browser storage without silently pruning observations or rewriting a journal when validation fails.
  const next = gemJournalSchema.safeParse(result.journal);
  const encoded = JSON.stringify(result.journal);
  if (
    !next.success ||
    new TextEncoder().encode(encoded).length > 10 * 1024 * 1024
  ) {
    await tx.done;
    return {
      journal: parsed.data,
      status:
        "Gem tracking storage limit reached. Existing observations are preserved; no new observation was saved.",
    };
  }
  if (encoded !== JSON.stringify(parsed.data))
    await tx.store.put(next.data, `gem-tracking:${owner}`);
  await tx.done;
  return result;
}
