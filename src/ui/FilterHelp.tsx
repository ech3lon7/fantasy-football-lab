import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Shared filter definitions keep the same meaning on team, player and Gem screens; they never calculate or assign labels.
export const filterHelp: Record<string, string> = {
  Team: "Choose the fantasy team whose roster you want to inspect. This does not change ESPN ownership.",
  Position:
    "Restrict results to the selected player position. All removes this position restriction; other filters still apply.",
  Ownership:
    "All includes every player. Available means free agents/waivers; a team selection shows that team's roster. A listing does not guarantee a successful claim.",
  "Player pool":
    "Available shows free agents/waivers; All includes rostered players; Selected team uses the team you choose. Example: choose All to investigate trade targets.",
  "Breakout classification":
    "Gem requires strong scoring and workload in both overlapping three-game windows, with active availability. Watch uses workload opportunity rules. Classification combines with your signal and numeric filters.",
  "Search players":
    "Filter the current player pool by name. Position and ownership selections still apply.",
  "Search this roster":
    "Filter this team's player choices by name without changing selections already in the trade. Select a player, then click their displayed name to inspect stats without leaving the analyzer.",
  "All evaluation fields":
    "Show the full evaluation columns, including recorded scoring, forecasts, surplus value and data status. This changes the display, not player values.",
  "All fields":
    "Show the full evaluation columns without changing the selected players or their calculated values.",
  "Include injured":
    "Include injured players in screening. Their injury and availability warnings still apply; enabling this does not assume a recovery date.",
  "Signals - match any selected":
    "Selected signals are OR choices; other filter categories use AND. Clear all signals for Any signal. Example: Gem or Watch plus Trend PPG ≥ 2.",
  Gem: "Strong actual scoring and sustained workload in both overlapping three-game windows, with active availability. This is an automatic production signal, not a guarantee or market price.",
  Watch:
    "A developing workload opportunity that does not pass every Gem gate. Workload, rather than a required scoring breakout, drives this label.",
  "Projection-gap watch":
    "Actual season PPG exceeds ESPN's season projected PPG, with recent scoring confirmation. This does not use ESPN's current-week matchup projection.",
  "Scoring breakout watch":
    "Latest-three-game actual PPG improves on ALL earlier played games and meets the season projection. Workload growth is not required.",
  "Role-growth watch":
    "Recent workload rises versus ALL earlier played games while meeting the positional opportunity minimum. It is separate from primary Watch.",
  "Reduced workload":
    "Sustained workload decline versus the immediately preceding two or three played games, supported by at least two recent games. This does not automatically change value.",
  "TD caution":
    "Elevated touchdown conversion at lower opportunity volume may be difficult to sustain. It repeats SELL HIGH evidence without another value penalty.",
  "BUY LOW":
    "High recorded workload with low touchdown conversion versus positional peers suggests room for more touchdowns. Review the player's Why BUY LOW? evidence; this is not a market price or an automatic trade recommendation.",
  "SELL HIGH":
    "Elevated touchdown conversion versus positional peers at lower workload may be difficult to sustain. Review the player's Why SELL HIGH? evidence; this does not by itself make trading the player a good deal.",
  "No breakout signal":
    "No qualifying Gem or developing-workload label under the imported snapshot. This does not mean the player is bad.",
  "Insufficient data":
    "Evidence is incomplete or invalid. This is not a confirmed failure of the Gem scoring or workload requirements.",
  "Not applicable":
    "The primary Gem/Watch classifier applies to RB, WR and TE. Other positions can still have independent scoring signals.",
  "Minimum trend PPG":
    "Latest three played-game actual PPG minus ALL earlier played-game PPG. Example: 16 recent minus 12 earlier gives +4 trend PPG. Blank disables the limit; zero is a real threshold.",
  "Minimum surplus index":
    "Minimum normalized remaining-season surplus above available replacements, not a market price. Bounds are inclusive; blank disables this limit.",
  "Maximum surplus index":
    "Maximum normalized remaining-season surplus above available replacements. Example: minimum 10 and maximum 40 includes indices from 10 through 40.",
  "Minimum recent PPG":
    "Minimum actual scoring average across the latest three played games, or all played games if fewer exist. Zero and negative played-game scores remain included.",
  "Minimum games played":
    "Require at least this many verified completed games. Byes and nonparticipation do not count as games.",
  "Minimum projection gap PPG":
    "Actual season PPG minus ESPN season projected PPG. Example: 18 actual minus 14 projected gives +4 PPG. This is not a current-week matchup comparison.",
  "Minimum role increase / game":
    "Recent positional workload per game minus ALL earlier played-game workload per game: carries + targets for RB, targets for WR/TE, carries for QB.",
  "Minimum recent targets / game":
    "Average recorded targets in the latest three played games. Targets are opportunities, not fantasy points.",
  "Minimum recent carries / game":
    "Average recorded rushing attempts in the latest three played games. This does not treat carries and targets as equal scoring value.",
  "Minimum route participation (0–1)":
    "Require sourced recent route participation. Shares use 0–1: 0.70 means 70%. Missing supplemental coverage remains unavailable.",
  "Above replacement only":
    "Require positive remaining-season VORP above the position's available replacement baseline. This does not by itself establish a useful pickup or fair trade.",
  "Show players with missing filter data":
    "List incomplete evidence separately from confirmed matches. Known filter failures remain excluded; missing values are never treated as zero.",
  "Rising targets":
    "An editable example search, not a validated cutoff. Review its active chips before applying your own criteria.",
};

// Existing labels and controls reveal help without extra icons, cursor styling or tab stops.
export function FilterHelp({
  label,
  help = filterHelp[label],
  children,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  const id = useId(),
    host = useRef<HTMLSpanElement>(null),
    tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false),
    [position, setPosition] = useState({ left: 8, top: 8 });
  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const close = () => {
    cancel();
    setOpen(false);
  };
  const show = () => {
    cancel();
    setOpen(true);
  };
  const leave = () => {
    cancel();
    // Clear the completed timer too, so leaving and revisiting never disables future hover help.
    timer.current = setTimeout(close, 150);
  };
  // Tooltips wait 700ms on hover, stay usable under the pointer, and reposition outside scrolling panels.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = host.current?.getBoundingClientRect(),
        box = tip.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      // Help should not float over unrelated controls after its original label scrolls off screen.
      if (anchor.bottom < 0 || anchor.top > innerHeight) {
        close();
        return;
      }
      setPosition({
        left: Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8)),
        top: Math.max(
          8,
          anchor.bottom + box.height + 8 <= innerHeight
            ? anchor.bottom + 6
            : anchor.top - box.height - 6,
        ),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  // Escape, outside taps and opening another tooltip dismiss help without changing any filter value.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (
        !host.current?.contains(e.target as Node) &&
        !tip.current?.contains(e.target as Node)
      )
        close();
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== id) close();
    };
    window.dispatchEvent(
      new CustomEvent("fantasy-filter-help", { detail: id }),
    );
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("fantasy-filter-help", other);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("fantasy-filter-help", other);
    };
  }, [open, id]);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Describe the native controls while help is open, preserving any existing accessible descriptions.
  useEffect(() => {
    if (!open) return;
    const controls = host.current?.querySelectorAll(
      "input, select, textarea, button",
    );
    const previous = Array.from(controls ?? [], (control) => {
      const description = control.getAttribute("aria-describedby");
      control.setAttribute(
        "aria-describedby",
        [description, id].filter(Boolean).join(" "),
      );
      return { control, description };
    });
    return () =>
      previous.forEach(({ control, description }) => {
        if (description === null) control.removeAttribute("aria-describedby");
        else control.setAttribute("aria-describedby", description);
      });
  }, [open, id]);
  if (!help) return <>{children}</>;
  return (
    <span
      className="filter-help-control"
      ref={host}
      onPointerEnter={(event) => {
        // Only a deliberate mouse hover starts help; focusing, typing and tapping never open it.
        if (event.pointerType === "mouse") {
          // Returning before the exit delay finishes must cancel dismissal, rather than leave a stale timer.
          cancel();
          if (!open) timer.current = setTimeout(show, 700);
        }
      }}
      onPointerLeave={leave}
      // Editing dismisses visible help and cancels any hover timer without changing the control's action.
      onPointerDown={close}
      onFocus={close}
      onKeyDown={close}
      onInput={close}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) close();
      }}
    >
      {children}
      {open &&
        createPortal(
          <div
            className="filter-tooltip"
            id={id}
            ref={tip}
            role="tooltip"
            style={position}
            onMouseEnter={show}
            onMouseLeave={leave}
          >
            {help}
          </div>,
          document.body,
        )}
    </span>
  );
}
