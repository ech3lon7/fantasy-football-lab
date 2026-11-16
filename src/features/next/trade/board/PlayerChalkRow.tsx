import { useLayoutEffect, useRef } from "react";
import type { Player } from "../../../../domain/valuation";
import { PlayerPhoto } from "../../../../ui/PlayerPhoto";
import { motion, useBoardMotion } from "./board-motion";

const eppg = (p: Player) => (p.blendedExpected === null || p.blendedExpected === undefined ? "—" : p.blendedExpected.toFixed(1));
const surplus = (p: Player) => (p.index === null || p.index === undefined ? "—" : String(Math.round(p.index)));

// One player in a panel (Never trade, I get, I give): a 40px round photo with the shared head-and-shoulders framing, the name, "POS · NFL"
// and the same EPPG and Surplus index the player card shows, in yellow chalk. A missing value is "—", never 0. A selected row gets a
// scribbled check and a hatch behind it (M12); hovering or focusing one sweeps an underline under the name and lifts the photo (M11).
export function PlayerChalkRow({
  player,
  selected,
  onToggle,
}: {
  player: Player;
  selected: boolean;
  onToggle: () => void;
}) {
  const bm = useBoardMotion();
  const root = useRef<HTMLButtonElement>(null);
  const was = useRef(selected);
  const enter = () => {
    const el = root.current;
    if (!el) return;
    bm.play("row-underline", el.querySelector(".gd-prow-underline"), motion.underline, { silent: true });
    bm.play("row-lift", el.querySelector(".gd-prow-photo"), motion.lift, { silent: true });
  };
  // The check scribbles in and the hatch sweeps across when the row becomes selected; the check is smudged out when it stops being.
  useLayoutEffect(() => {
    if (was.current === selected) return;
    was.current = selected;
    const el = root.current;
    if (!el) return;
    if (selected) {
      bm.play("row-hatch", el.querySelector(".gd-prow-hatch"), motion.hatchSweep);
      bm.play("row-tick", el.querySelector(".gd-ctick path"), motion.tickIn, { silent: true });
    } else {
      bm.play("row-untick", el.querySelector(".gd-ctick"), motion.tickOut);
    }
  }, [selected]);
  return (
    <button
      ref={root}
      type="button"
      className="gd-prow"
      aria-pressed={selected}
      data-key={player.id}
      onMouseEnter={enter}
      onFocus={enter}
      onClick={onToggle}
    >
      <span className="gd-prow-hatch" data-on={selected} data-motion="M12" aria-hidden="true" />
      <span className="gd-prow-photo" data-motion="M11" aria-hidden="true">
        <PlayerPhoto player={player} size="fill" />
      </span>
      <span className="gd-prow-text">
        <span className="gd-prow-name">
          <svg className="gd-ctick" data-on={selected} viewBox="0 0 20 16" aria-hidden="true" data-motion="M12">
            <path d="M2 9 L7 14 L18 2" pathLength={1} />
          </svg>
          {player.name}
          <span className="gd-prow-underline" data-motion="M11" aria-hidden="true" />
        </span>
        <span className="gd-prow-meta">
          {player.pos} · {player.nfl || "—"}
        </span>
      </span>
      <span className="gd-prow-nums">
        <span className="gd-prow-eppg">
          EPPG <b>{eppg(player)}</b>
        </span>
        <span className="gd-prow-surplus">
          Surplus <b>{surplus(player)}</b>
        </span>
      </span>
    </button>
  );
}
