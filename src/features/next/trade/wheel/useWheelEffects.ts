import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { FeedbackKind } from "../../../../ui/feel/settings";
import {
  MotionRunner,
  chalkSpecs,
  motionLevel,
  tween,
  type ChalkEffect,
} from "./chalk-motion";
import type { CategoryId } from "./wheel-model";

// The motion of the wheel, in one place. The component keeps its structure and state; this hook watches that state and plays the
// effect of the handoff's section 6.2 that belongs to each change. Every effect reads the Feel setting when it plays: Full plays
// everything, Reduced plays fades only, Off plays nothing and the interface changes at once. No effect blocks input: a new
// interaction finishes the running effect of the same kind.

interface Args {
  board: RefObject<HTMLElement | null>;
  fit: RefObject<HTMLElement | null>;
  scrim: RefObject<HTMLElement | null>;
  opener: RefObject<HTMLElement | null>;
  focus: number;
  category: CategoryId | null;
  optionId: string | null;
  page: number;
  // Changes whenever a slider value changes: "optionId:lo:hi".
  valueKey: string;
  // The on/off state of the toggles on the arc, as a string of 0 and 1.
  togglesOn: string;
  hides: number | undefined;
  // Changes when the players list changes.
  matchesKey: string;
  cue: (kind: FeedbackKind) => void;
  lastInput: MutableRefObject<"mouse" | "key" | "touch">;
}

const PUFFS = 6;

export function useWheelEffects(a: Args) {
  const runner = useRef(new MotionRunner());
  const first = useRef(true);
  const previous = useRef({
    focus: a.focus,
    category: a.category,
    optionId: a.optionId,
    page: a.page,
    valueKey: a.valueKey,
    togglesOn: a.togglesOn,
    matches: a.matchesKey,
  });
  const [puffs, setPuffs] = useState<{ id: number; dx: number; dy: number }[]>(
    [],
  );
  const [shownHides, setShownHides] = useState(a.hides ?? 0);
  const [trail, setTrail] = useState<{ id: number; x: number; y: number }[]>(
    [],
  );
  const trailId = useRef(0);

  const all = <T extends Element>(selector: string) => [
    ...(a.board.current?.querySelectorAll<T>(selector) ?? []),
  ];
  const play = useCallback(
    (
      key: string,
      el: Element | null | undefined,
      effect: ChalkEffect,
      extra?: { delay?: number; vars?: Record<string, string> },
    ) => (el ? runner.current.play(key, el, chalkSpecs[effect], extra) : null),
    [],
  );
  const cueFor = (effect: ChalkEffect) => {
    const kind = chalkSpecs[effect].cue;
    if (kind) a.cue(kind);
  };

  // A1 Open: the backdrop dims, a dust puff at the button, the frame springs in, rings and spokes draw, labels are written.
  useLayoutEffect(() => {
    const level = motionLevel();
    cueFor("open");
    if (level === "off") return;
    play("backdrop", a.scrim.current, "backdrop");
    play("open", a.fit.current, "open");
    if (level === "full") {
      setPuffs(
        Array.from({ length: PUFFS }, (_, i) => ({
          id: i,
          dx: Math.cos((i / PUFFS) * Math.PI * 2) * 34,
          dy: Math.sin((i / PUFFS) * Math.PI * 2) * 34,
        })),
      );
      window.setTimeout(() => setPuffs([]), 320);
    }
    const draws = all<SVGElement>(".gd-mask-draw");
    draws.forEach((el, i) =>
      play(`draw${i}`, el, i < 3 ? "drawRing" : "drawSpoke", {
        delay: i < 3 ? 0 : (i - 3) * 40,
      }),
    );
    all<SVGElement>(".gd-write-clip").forEach((el, i) =>
      play(`write${i}`, el, "writeLabel", { delay: 120 + i * 30 }),
    );
    all<SVGElement>(".gd-seg-set").forEach((el, i) =>
      play(`mark${i}`, el, "popMark", { delay: 400 + i * 30 }),
    );
    return () => runner.current.finishAll();
  }, []);

  // Everything after the first render reacts to a change of state.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const was = previous.current;
    const seg = (i: number) =>
      a.board.current?.querySelector<SVGElement>(
        `.gd-wheel-seg[data-index="${i}"]`,
      );

    // A2 Hover or focus a segment: the hatch sweeps in, the previous one is smudged off, the label wiggles.
    if (was.focus !== a.focus && a.category === null) {
      play("smudge", seg(was.focus)?.querySelector(".gd-seg-hatch"), "smudge");
      play("hatch", seg(a.focus)?.querySelector(".gd-seg-hatch"), "hover");
      play("wiggle", seg(a.focus)?.querySelector(".gd-seg-label"), "wiggle");
      if (a.lastInput.current !== "mouse") cueFor("hover");
    }
    // A3 Choose a category, or A8 go back to Ring 1.
    if (was.category !== a.category) {
      if (a.category) {
        play("choose", seg(a.focus), "chooseCategory");
        all<SVGElement>(".gd-wheel-seg[data-dim]").forEach((el, i) =>
          play(`dim${i}`, el, "dimOthers"),
        );
        all<HTMLElement>(".gd-wheel-pill").forEach((el, i) =>
          play(`pill${i}`, el, "writePill", { delay: i * 50 }),
        );
        cueFor("chooseCategory");
      } else {
        all<SVGElement>(".gd-wheel-seg").forEach((el, i) =>
          play(`undim${i}`, el, "unDim"),
        );
        cueFor("eraser");
      }
    }
    // A4 Choose a sub-option: the new pill is drawn solid, the arc draws outward, toggles are written in.
    if (was.optionId !== a.optionId && a.optionId) {
      play(
        "pillOn",
        a.board.current?.querySelector(".gd-wheel-pill[data-on='true']"),
        "pillOn",
      );
      play("route", a.board.current?.querySelector(".gd-arc-route"), "drawArc");
      all<SVGElement>(".gd-bubble").forEach((el, i) =>
        play(`bubble${i}`, el, "writePill", { delay: i * 50 }),
      );
      play(
        "hubValue",
        a.board.current?.querySelector(".gd-hub-value"),
        "rollIn",
      );
      cueFor("pillOn");
    }
    // A5 Drag the arc slider: the handle squashes at each step, the number rolls in, "hides N" counts to its new value.
    if (was.valueKey !== a.valueKey && was.optionId === a.optionId) {
      play(
        "squash",
        a.board.current?.querySelector(".gd-arc-handle-o"),
        "squash",
      );
      play(
        "hubValue",
        a.board.current?.querySelector(".gd-hub-value"),
        "rollIn",
      );
      cueFor("squash");
      if (motionLevel() === "full") {
        const handle = a.board.current
          ?.querySelector(".gd-arc-handle-o")
          ?.getBoundingClientRect();
        const box = a.board.current?.getBoundingClientRect();
        if (handle && box) {
          const id = (trailId.current += 1);
          // At most eight crumbs of dust at a time.
          setTrail((t) => [
            ...t.slice(-7),
            {
              id,
              x: handle.left - box.left + handle.width / 2,
              y: handle.top - box.top + handle.height / 2,
            },
          ]);
          window.setTimeout(
            () => setTrail((t) => t.filter((c) => c.id !== id)),
            420,
          );
        }
      }
    }
    // A6 Toggle an option: a tick scribbles in, or is smudged out.
    if (
      was.togglesOn !== a.togglesOn &&
      was.optionId === a.optionId &&
      was.page === a.page
    ) {
      const bubbles = all<SVGElement>(".gd-bubble");
      bubbles.forEach((bubble, i) => {
        const before = was.togglesOn[a.page * 8 + i];
        const now = a.togglesOn[a.page * 8 + i];
        if (before === now) return;
        play(
          `tick${i}`,
          bubble.querySelector(".gd-chalk-tick"),
          now === "1" ? "tickIn" : "tickOut",
        );
        cueFor("tickIn");
      });
    }
    // A7 Rotate a long arc: the bubbles turn to the next page with a slight overshoot.
    if (was.page !== a.page) {
      play(
        "rotate",
        a.board.current?.querySelector(".gd-wheel-bubbles"),
        "rotate",
        { vars: { "--from": `${a.page > was.page ? 28 : -28}deg` } },
      );
      cueFor("rotate");
    }
    // A9 Players search: the names are written in, thirty milliseconds apart, at most eight.
    if (was.matches !== a.matchesKey)
      all<HTMLElement>(".gd-panel-item")
        .slice(0, 8)
        .forEach((el, i) =>
          play(`name${i}`, el, "writeName", { delay: i * 30 }),
        );

    previous.current = {
      focus: a.focus,
      category: a.category,
      optionId: a.optionId,
      page: a.page,
      valueKey: a.valueKey,
      togglesOn: a.togglesOn,
      matches: a.matchesKey,
    };
  }, [
    a.focus,
    a.category,
    a.optionId,
    a.page,
    a.valueKey,
    a.togglesOn,
    a.matchesKey,
  ]);

  // A14 "hides N" counts to its new value; at Reduced and Off it simply changes.
  const hidesNow = a.hides ?? 0;
  const shownRef = useRef(shownHides);
  shownRef.current = shownHides;
  useEffect(
    () => tween(shownRef.current, hidesNow, motionLevel(), setShownHides),
    [hidesNow],
  );

  // A11 Done or close: the whole board collapses into the Filters button. Calls `then` when it has finished.
  const close = useCallback((then: () => void) => {
    const fit = a.fit.current;
    const button = a.opener.current?.getBoundingClientRect();
    if (!fit || motionLevel() === "off") return then();
    const box = fit.getBoundingClientRect();
    const vars = button
      ? {
          "--dx": `${button.left + button.width / 2 - (box.left + box.width / 2)}px`,
          "--dy": `${button.top + button.height / 2 - (box.top + box.height / 2)}px`,
        }
      : { "--dx": "0px", "--dy": "0px" };
    cueFor("done");
    const done = play("close", fit, "done", { vars });
    if (!done) return then();
    play("backdropOut", a.scrim.current, "backdrop");
    done.finished.then(then, then);
  }, []);

  // A8 Back: an eraser wipes the sub-ring away in the direction it was drawn; then the state changes. Esc again skips the wipe.
  const erase = useCallback((then: () => void) => {
    const targets = [
      ".gd-arc-slider",
      ".gd-wheel-bubbles",
      ".gd-wheel-panel",
      ".gd-wheel-pills",
    ]
      .map((s) => a.board.current?.querySelector(s))
      .filter(Boolean) as Element[];
    if (!targets.length || motionLevel() === "off") return then();
    const running = targets
      .map((el, i) => play(`erase${i}`, el, "eraser"))
      .filter(Boolean) as Animation[];
    if (!running.length) return then();
    cueFor("eraser");
    Promise.all(running.map((r) => r.finished)).then(then, then);
  }, []);

  // A10 Clear all: a full-board eraser wipe, then the defaults are redrawn.
  const wipe = useCallback((apply: () => void) => {
    const svg = a.board.current?.querySelector(".gd-wheel-svg");
    const hub = a.board.current?.querySelector(".gd-wheel-hub");
    cueFor("clearAll");
    const w = [
      play("wipeSvg", svg, "clearAll"),
      play("wipeHub", hub, "clearAll"),
    ].filter(Boolean) as Animation[];
    if (!w.length) return apply();
    Promise.all(w.map((x) => x.finished)).then(() => {
      apply();
      window.requestAnimationFrame(() => {
        play("redrawSvg", svg, "redraw");
        play("redrawHub", hub, "redraw");
        all<SVGElement>(".gd-write-clip").forEach((el, i) =>
          play(`rewrite${i}`, el, "writeLabel", { delay: i * 30 }),
        );
      });
    }, apply);
  }, []);

  // A16 A refused value shakes and a chalk underline is drawn under it.
  const shake = useCallback((el: Element | null | undefined) => {
    play("shake", el, "shake");
    cueFor("shake");
  }, []);

  // A5 At either end of the track the handle thunks.
  const thunk = useCallback(() => {
    play("thunk", a.board.current?.querySelector(".gd-arc-handle-o"), "thunk");
    cueFor("thunk");
  }, []);

  return { puffs, trail, shownHides, close, erase, wipe, shake, thunk, play };
}
