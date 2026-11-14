import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Player } from "../../domain/valuation";
import type { PlayerCard } from "../../domain/view/player-card";
import type { PlayerTierInfo } from "../../domain/player-tier";
import {
  breadcrumb,
  formBar,
  positionName,
  splitName,
  tierBadge,
} from "../../domain/view/player-hero";
import { paparazziFlashes, playEntrance } from "../../ui/feel/entrances";
import { useCardEntrances } from "../../ui/feel/feedback";
import { PlayerPhoto } from "../../ui/PlayerPhoto";

// The identity half of the player card header: halftone, rank numeral, portrait, name, form bar, tier badge, profile panel
// and the tier entrance. Everything shown comes from the card's own numbers; the tier is display only.
export function PlayerHero({
  p,
  h,
  info,
  chips,
}: {
  p: Player;
  h: PlayerCard["header"];
  info: PlayerTierInfo | undefined;
  chips: ReactNode;
}) {
  const entrances = useCardEntrances();
  const tier = info?.tier ?? null;
  const badge = tierBadge(tier, info?.rank ?? null);
  const name = splitName(h.name, h.pos);
  const form = formBar(p.recent, p.blendedExpected);
  // The overlays exist only while entrances are allowed at full motion; Reduced and Off render none.
  const [run, setRun] = useState(0);
  const cancel = useRef<() => void>(() => {});
  const photoRef = useRef<HTMLDivElement>(null);

  // Measure the end of the stats row so the phone photo stops before the profile panel.
  useEffect(() => {
    const hero = photoRef.current?.closest<HTMLElement>(".gd-hx");
    const stats = hero?.querySelector<HTMLElement>(".gd-card-nums");
    if (!hero || !stats) return;
    const measure = () => hero.style.setProperty("--hx-photo-region", `${stats.getBoundingClientRect().bottom - hero.getBoundingClientRect().top}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(hero); observer.observe(stats); measure();
    return () => { observer.disconnect(); hero.style.removeProperty("--hx-photo-region"); };
  }, [p.id]);

  const play = useCallback(() => {
    cancel.current();
    if (!tier || !entrances.enabled) return;
    if (document.documentElement.dataset.animation !== "full") {
      setRun(0);
      return;
    }
    setRun((n) => n + 1);
    cancel.current = playEntrance(tier, entrances);
  }, [tier, entrances]);

  // A new card, or a new player in the same card, plays once; leaving cancels anything still pending.
  useEffect(() => {
    play();
    return () => cancel.current();
    // Only the player and the tier start an entrance; a settings change must not replay it.
  }, [p.id, tier]);

  const showFx = run > 0 && !!tier && entrances.enabled;
  const ppg =
    info?.ppg === null || info?.ppg === undefined
      ? "—"
      : `${info.ppg.toFixed(1)}${info.rank !== null ? ` · #${info.rank} of ${info.rankedCount}` : " · unranked"}`;

  return (
    <>
      {/* Fill the entire player-card hero with the same translucent portrait used on roster cards. */}
      <div className="gd-hx-photo" ref={photoRef}><PlayerPhoto player={p} size="fill" /></div>
      <div className="gd-hx-dots" aria-hidden="true" />
      {info?.rank != null && (
        <span className="gd-hx-num" aria-hidden="true">
          {info.rank}
        </span>
      )}
      <span className="gd-hx-crumb">{breadcrumb(window.location.hash)}</span>
      <aside className="gd-hx-bio" aria-label="Profile">
        <div className="gd-hx-bio-h">◉ Profile</div>
        <div className="gd-hx-bio-r">
          <span>Fantasy team</span>
          <b>{h.owner || "Free agent"}</b>
        </div>
        <div className="gd-hx-bio-r">
          <span>Status</span>
          <b>{h.injury || "Active"}</b>
        </div>
        <div className="gd-hx-bio-r">
          <span>FPTS / game</span>
          <b>{ppg}</b>
        </div>
        <div className="gd-hx-bio-r">
          <span>Games</span>
          <b>{p.games}</b>
        </div>
        <div className="gd-hx-bio-r">
          <span>ESPN season</span>
          <b>{p.projected === null ? "—" : `${p.projected.toFixed(1)} PPG`}</b>
        </div>
        <div className="gd-hx-posname">{positionName(h.pos)}</div>
      </aside>
      <div className="gd-hx-id">
        <div className="gd-hx-name">
          <h2>
            {name.first && <span className="gd-hx-first">{name.first} </span>}
            <span className="gd-hx-last">{name.last}</span>
          </h2>
          <div className="gd-hx-meta">
            {h.pos} · {h.nfl} · {p.games} games · {h.owner || "Free agent"}
          </div>
          <div
            className="gd-hx-form"
            data-kind={form.kind}
            title={form.tip}
            tabIndex={0}
            aria-label={`Form: ${form.label}. ${form.tip}`}
          >
            <span>Form</span>
            <i aria-hidden="true">
              {form.widthPct !== null && (
                <b style={{ width: `${form.widthPct}%` }} />
              )}
            </i>
            <span>{form.label}</span>
          </div>
          <div className="gd-hx-row gd-card-labels">
            {badge && (
              <button
                type="button"
                className="gd-tier"
                data-tier={badge.tier}
                title={badge.tip}
                aria-label={badge.aria}
                onClick={play}
              >
                {badge.text}
              </button>
            )}
            {chips}
          </div>
        </div>
      </div>
      {showFx && tier === "superstar" && (
        <div key={run} className="fx fx-pap" aria-hidden="true">
          <b />
          {paparazziFlashes.map((f) => (
            <i
              key={f.delayS}
              style={{
                left: `${f.left}%`,
                top: `${f.top}%`,
                width: f.size,
                height: f.size,
                animationDelay: `${f.delayS}s`,
              }}
            />
          ))}
        </div>
      )}
      {showFx && tier === "star" && (
        <div key={run} className="fx fx-shine" aria-hidden="true">
          <i />
          <i className="thin" />
        </div>
      )}
      {showFx && tier === "good" && (
        <div key={run} className="fx fx-glint" aria-hidden="true">
          <i />
        </div>
      )}
    </>
  );
}
