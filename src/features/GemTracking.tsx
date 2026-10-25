import {
  gemTrackingReport,
  type GemTrackingState,
} from "../domain/gem-tracking";
import { useEffect, useState } from "react";
import { DataTable, fmt } from "../ui/components";
import { Panel } from "../ui/layout";

// Display read-only prospective comparisons; domain-owned counts keep shadow trials separate from live Gem qualification.
export function GemTracking({
  tracking,
}: {
  tracking: Promise<GemTrackingState> | null;
}) {
  // Only the audit panel subscribes to completion; stale account/dataset promises cannot display their previous results.
  const [resolved, setResolved] = useState<{
    job: Promise<GemTrackingState>;
    data: GemTrackingState;
  } | null>(null);
  useEffect(() => {
    let active = true;
    if (tracking)
      void tracking.then((data) => {
        if (active) setResolved({ job: tracking, data });
      });
    return () => {
      active = false;
    };
  }, [tracking]);
  const state = resolved?.job === tracking ? resolved?.data : null;
  const cohorts = gemTrackingReport(
    state?.journal ?? { version: 1, cohorts: [] },
  );
  const accuracy = (hits: number, scored: number, labels: number) =>
    scored
      ? `${hits}/${scored} (${fmt((100 * hits) / scored, 1)}%)`
      : labels
        ? "Awaiting outcomes"
        : "No labels";
  return (
    <Panel
      title="Prospective Gem tracking"
      note="Automatic observation, not automatic retuning. Live Gem, Watch and trade values stay unchanged."
    >
      <p>{state?.status ?? "Loading this account’s local tracking journal…"}</p>
      <details>
        <summary>Method and storage</summary>
        <p>
          Stored only in this browser for this account; not synced to other
          devices. The journal stores dated classifications, not copies of your
          Excel files. Clearing account data, signing out or clearing browser
          storage removes it.
        </p>
        <p>
          The first fresh source (within 24 hours) observed per current-season
          week is frozen with its source time, dataset hash and rule definition.
          Old weeks are never backfilled. Four verified played games, complete
          workload history, ACTIVE status and remaining availability define the
          tracked RB/WR/TE population; unlabelled eligible players are recorded
          too.
        </p>
        <p>
          Confidence, rarity and coverage are frozen research trials, not
          validated promises. The final trial removes only the individual-game
          workload-support check. These shadow classifications never appear as
          player tags or affect values.
        </p>
        <p>
          Success means future actual PPG fits this league’s positional starter
          pool plus FLEX over the next three or five calendar weeks, with at
          least two or three games played, respectively. Verified insufficient
          participation counts as failure; missing history waits for a complete
          import. Byes are not played games; zero and negative scores count.
          Outcomes are frozen at the first complete, later-dated import.
        </p>
        <p>
          First alerts mean first recorded since tracking began, not first ever
          in the season. Repeated weekly observations overlap and are not
          independent samples. Missed productive cases are eligible player-weeks
          that later met the same production test without that label. Cohorts
          separate seasons, rules, scoring, roster formats and team identities;
          changes in team names can start a new cohort. No individual success
          probability or automatic rule promotion is inferred.
        </p>
      </details>
      {/* Keep the growing audit collapsed and contained in existing responsive table wrappers. */}
      {!cohorts.length && (
        <p className="muted">
          No prospective observations yet. A historical or stale workbook can
          still be used normally; it cannot create prospective evidence.
        </p>
      )}
      {cohorts.map((cohort) => (
        <details key={cohort.id}>
          <summary>
            {cohort.title} · {cohort.weeks} recorded week(s)
          </summary>
          <p>
            Accuracy includes only scored labels. Pending labels stay out of the
            denominator. Labels/week uses recorded eligible horizon weeks,
            including zero-label weeks; unobserved weeks are excluded.
          </p>
          <DataTable
            rows={cohort.rows}
            id={(r) => r.id}
            columns={[
              { key: "pos", label: "Position", value: (r) => r.pos },
              {
                key: "method",
                label: "Method (shadow trials)",
                value: (r) => r.method,
              },
              { key: "horizon", label: "Follow-up", value: (r) => r.horizon },
              {
                key: "first",
                label: "First recorded: successful / scored",
                kind: "fact",
                value: (r) =>
                  r.firstScored ? r.firstHits / r.firstScored : null,
                render: (r) => (
                  <>
                    <div>
                      {accuracy(r.firstHits, r.firstScored, r.firstLabels)}
                    </div>
                    <small>{r.firstLabels - r.firstScored} pending</small>
                  </>
                ),
              },
              {
                key: "weekly",
                label: "Repeated weekly: successful / scored",
                kind: "fact",
                value: (r) => (r.scored ? r.hits / r.scored : null),
                render: (r) => (
                  <>
                    <div>{accuracy(r.hits, r.scored, r.labels)}</div>
                    <small>{r.labels - r.scored} pending</small>
                  </>
                ),
              },
              {
                key: "volume",
                label: "Labels / recorded week",
                kind: "fact",
                value: (r) => (r.recordedWeeks ? r.perWeek : null),
                render: (r) =>
                  r.recordedWeeks
                    ? `${fmt(r.perWeek)} (${r.labels}/${r.recordedWeeks})`
                    : "Not applicable",
              },
              {
                key: "missed",
                label: "Missed productive cases",
                kind: "fact",
                value: (r) => (r.ready ? r.missed : null),
                render: (r) =>
                  r.ready
                    ? `${r.missed} (${r.lostCurrent} labelled by Current Gem)`
                    : "Awaiting outcomes",
              },
            ]}
          />
          <details>
            <summary>Dated observation audit</summary>
            <DataTable
              rows={cohort.checkpoints}
              id={(r) => String(r.week)}
              columns={[
                {
                  key: "week",
                  label: "Decision week",
                  kind: "fact",
                  value: (r) => r.week,
                },
                {
                  key: "source",
                  label: "Source UTC",
                  kind: "fact",
                  value: (r) => r.sourceUTC,
                },
                {
                  key: "captured",
                  label: "Recorded UTC",
                  kind: "fact",
                  value: (r) => r.capturedAt,
                },
                {
                  key: "hash",
                  label: "Source hash",
                  value: (r) => r.sourceHash,
                },
                {
                  key: "eligible",
                  label: "Eligible players",
                  kind: "fact",
                  value: (r) => r.eligible,
                },
                {
                  key: "three",
                  label: "3-week outcome",
                  value: (r) =>
                    r.three ? "Scored" : "Awaiting complete follow-up",
                },
                {
                  key: "five",
                  label: "5-week outcome",
                  value: (r) =>
                    r.five === null
                      ? "Beyond season cutoff"
                      : r.five
                        ? "Scored"
                        : "Awaiting complete follow-up",
                },
              ]}
            />
          </details>
        </details>
      ))}
    </Panel>
  );
}
