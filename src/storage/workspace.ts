import { openDB } from "idb";
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
export async function remove(owner: string) {
  const d = await db();
  await d.delete("current", owner);
}
