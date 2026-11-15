import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { str } from "../../../../domain/contracts";
import type { Model } from "../../../../domain/valuation";
import { useFeedback } from "../../../../ui/feel/feedback";
import { MotionRunner, chalkSpecs, motionLevel } from "./chalk-motion";

interface Progress {
  singles: number;
  extensions: number;
  done: boolean;
}

// The play call (A12): while Search all trades runs, a chalk diagram shows your team as an O and every opponent as an X. As each
// opponent's one-for-ones are checked a route is drawn to it, and when all its packages are done its X is circled. When the search
// ends the diagram shrinks and folds into the coverage line. At Reduced it is a plain progress bar; at Off nothing is drawn.
export function PlayCallScene({
  m,
  ownTeam,
  teams,
  running,
  failed,
  onGone,
}: {
  m: Model;
  ownTeam: string;
  teams: Record<string, Progress> | undefined;
  running: boolean;
  failed: boolean;
  // Called once the diagram has folded away (or at once at Off).
  onGone: () => void;
}) {
  const level = motionLevel();
  const notify = useFeedback();
  const root = useRef<HTMLDivElement>(null);
  const runner = useRef(new MotionRunner());
  const seen = useRef<Record<string, { route: boolean; circle: boolean }>>({});
  const lastTap = useRef(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  const opponents = useMemo(
    () =>
      m.dataset.tables.ModelTeams.filter(
        (t) => str(t.TeamID) !== "0" && str(t.TeamID) !== ownTeam,
      ).map((t) => ({ id: str(t.TeamID), name: str(t.TeamName) })),
    [m, ownTeam],
  );
  useEffect(() => {
    if (gone) onGone();
  }, [gone]);
  const doneCount = opponents.filter((t) => teams?.[t.id]?.done).length;
  const singles = Object.values(teams ?? {}).reduce((n, t) => n + t.singles, 0);
  const packages = Object.values(teams ?? {}).reduce(
    (n, t) => n + t.extensions,
    0,
  );

  // Where each X stands: two rows to the right of the O.
  const cols = Math.max(1, Math.ceil(opponents.length / 2));
  const at = (i: number) => ({
    x:
      250 +
      (i % cols) * (350 / Math.max(1, cols - 1 || 1)) * (cols > 1 ? 1 : 0),
    y: i < cols ? 62 : 146,
  });
  const O = { x: 84, y: 104 };

  // Steps 1 and 2: an eraser band sweeps across, then the diagram is written in.
  useLayoutEffect(() => {
    if (level !== "full" || !root.current) return;
    const band = root.current.querySelector(".gd-playcall-band");
    if (band) runner.current.play("band", band, chalkSpecs.sweep);
    root.current.querySelectorAll(".gd-pc-mark").forEach((el, i) =>
      runner.current.play(`mark${i}`, el, chalkSpecs.writeMark, {
        delay: 400 + i * 30,
      }),
    );
    return () => runner.current.finishAll();
  }, []);

  // Step 3: a route is drawn to each opponent as it is searched, and its X is circled when it is done.
  useEffect(() => {
    if (!teams || !root.current) return;
    for (const t of opponents) {
      const state = teams[t.id];
      const flags = (seen.current[t.id] ??= { route: false, circle: false });
      if (state && !flags.route) {
        flags.route = true;
        // The plain Reduced scene has no routes to draw.
        const route = root.current.querySelector(`[data-route="${t.id}"]`);
        if (route)
          runner.current.play(`route-${t.id}`, route, chalkSpecs.drawRoute);
        // One tap per team finished, no more often than every 150 ms.
        const now = performance.now();
        if (now - lastTap.current >= 150) {
          lastTap.current = now;
          notify("tap");
        }
      }
      if (state?.done && !flags.circle) {
        flags.circle = true;
        const circle = root.current.querySelector(`[data-circle="${t.id}"]`);
        if (circle)
          runner.current.play(`circle-${t.id}`, circle, chalkSpecs.circleMark);
      }
    }
  }, [teams, opponents]);

  // Step 5: when the search ends the diagram shrinks into the coverage line; a failed search says so instead.
  useEffect(() => {
    if (running) return;
    notify(failed ? "caution" : "success");
    if (level === "off" || !root.current) return setGone(true);
    setLeaving(true);
    const a = runner.current.play("morph", root.current, chalkSpecs.morph);
    if (!a) return setGone(true);
    a.finished.then(
      () => setGone(true),
      () => setGone(true),
    );
  }, [running]);

  if (level === "off" || gone) return null;
  if (level === "reduced")
    return (
      <div
        ref={root}
        className="gd-playcall gd-playcall-plain"
        aria-hidden="true"
      >
        <div className="gd-pc-bar">
          <i
            style={{
              width: `${opponents.length ? (doneCount / opponents.length) * 100 : 0}%`,
            }}
          />
        </div>
        <p>
          {doneCount} of {opponents.length} teams searched
        </p>
      </div>
    );

  return (
    <div
      ref={root}
      className="gd-playcall"
      data-leaving={leaving || undefined}
      aria-hidden="true"
    >
      <div className="gd-playcall-band" />
      <svg viewBox="0 0 640 200" width="100%" role="presentation">
        <g fill="none" strokeLinecap="round">
          {opponents.map((t, i) => {
            const p = at(i);
            const c = { x: (O.x + p.x) / 2, y: (O.y + p.y) / 2 - 22 };
            return (
              <g key={t.id}>
                <path
                  className="gd-pc-route"
                  data-route={t.id}
                  data-on={!!teams?.[t.id]}
                  d={`M${O.x + 22} ${O.y} Q${c.x} ${c.y} ${p.x - 18} ${p.y}`}
                  pathLength={1}
                />
                <circle
                  className="gd-pc-circle"
                  data-circle={t.id}
                  data-on={!!teams?.[t.id]?.done}
                  cx={p.x}
                  cy={p.y}
                  r="22"
                  pathLength={1}
                />
              </g>
            );
          })}
          <circle className="gd-pc-mark gd-pc-o" cx={O.x} cy={O.y} r="20" />
          {opponents.map((t, i) => {
            const p = at(i);
            return (
              <g
                key={t.id}
                className="gd-pc-mark gd-pc-x"
                transform={`translate(${p.x} ${p.y})`}
              >
                <path d="M-11 -11 L11 11 M11 -11 L-11 11" />
              </g>
            );
          })}
        </g>
        <text className="gd-pc-label" x={O.x} y={O.y + 44} textAnchor="middle">
          you
        </text>
        <text className="gd-pc-count" x="320" y="192" textAnchor="middle">
          {doneCount}/{opponents.length} teams · {singles.toLocaleString()}{" "}
          one-for-ones · {packages.toLocaleString()} packages
        </text>
      </svg>
    </div>
  );
}
