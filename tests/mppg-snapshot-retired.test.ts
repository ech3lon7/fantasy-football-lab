import { describe, expect, it } from "vitest";
import { initialState } from "../src/domain/contracts";
import {
  mppgSnapshotsKey,
  withoutMppgSnapshots,
} from "../src/domain/mppg-tuning";
import { bigLeagueFixture } from "./big-league-fixture";

describe("retired MPPG import snapshots", () => {
  // Removing the retired entry preserves every other filter and leaves the original state intact.
  it("removes only the snapshot key", () => {
    const filters = {
      sort: "name",
      enabled: false,
      count: 0,
      empty: null,
      nested: { value: 2 },
    };
    const state = {
      filters: { ...filters, [mppgSnapshotsKey]: "old snapshot" },
      preferredTeam: "1",
    };
    const cleaned = withoutMppgSnapshots(state);
    expect(cleaned.filters).toEqual(filters);
    expect(Object.keys(cleaned.filters)).toEqual(Object.keys(filters));
    expect(cleaned.filters.nested).toBe(filters.nested);
    expect(cleaned.preferredTeam).toBe(state.preferredTeam);
    expect(state.filters[mppgSnapshotsKey]).toBe("old snapshot");
  });

  // States without legacy snapshots need no replacement object.
  it("returns the same object when the snapshot is absent", () => {
    const state = { filters: { sort: "name" } };
    expect(withoutMppgSnapshots(state)).toBe(state);
  });

  // A realistic league remains within the synced state limit after its oversized snapshot is stripped.
  it("removes the oversized snapshot from a twelve-team state", async () => {
    const state = initialState(await bigLeagueFixture(12));
    state.filters[mppgSnapshotsKey] = "x".repeat(72_476);
    expect(JSON.stringify(state).length).toBeGreaterThan(65_536);
    expect(
      JSON.stringify(withoutMppgSnapshots(state)).length,
    ).toBeLessThanOrEqual(65_536);
  });
});
