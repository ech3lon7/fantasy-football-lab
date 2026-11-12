import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PlayerPopoverContext } from "../../ui/PlayerName";
import { PlayerStockChart } from "../../ui/PlayerStockChart";
import { NextRefreshScenarios } from "../../ui/NextRefreshScenarios";
import { LabelWhy } from "../../ui/LabelWhy";
import { usePopovers } from "../../ui/popover/PopoverStack";
import { isEditableTarget } from "../../ui/popover/keys";
import { playerCard, type Provenance } from "../../domain/view/player-card";
import { labelTone } from "../../domain/view/labels";
import type { Model } from "../../domain/valuation";
import { Chip } from "../../ui/primitives";
import { Radar } from "./Radar";
import { PlayerEvidence } from "./PlayerEvidence";
import { VersusView } from "./Versus";
import { addToVersus } from "../../domain/view/versus";
import { useFeedback } from "../../ui/feel/feedback";
import { PlayerPhoto } from "../../ui/PlayerPhoto";

export const tabs = ["story", "numbers", "why", "calc"] as const;
export type CardTab = (typeof tabs)[number];
const tabLabels: Record<CardTab, string> = {
  story: "Story",
  numbers: "Numbers",
  why: "Why the labels",
  calc: "Calculation",
};
// Remember the last tab in the existing string-valued filter record; unknown values open on Story.
export const cardTabKey = "cardLastTab";
export const readCardTab = (raw?: string): CardTab =>
  tabs.find((t) => t === raw) ?? "story";

// Glyph pairs with colour so provenance never relies on colour alone.
const glyph: Record<Provenance, string> = { fact: "●", espn: "◆", model: "▲" };

interface Opener {
  openPlayer: (id: string, list?: string[]) => void;
  // Choose a player for the two-player comparison; the comparison opens once two are chosen.
  addToVersus: (id: string) => void;
  openVersus: () => void;
}

// Read the ids of the rows around a clicked link, so any marked table lets the card step to the next player.
export function listFromAnchor(anchor: HTMLElement): string[] | undefined {
  const row = anchor.closest("[data-player-row]");
  const siblings = row?.parentElement?.querySelectorAll(
    ":scope > [data-player-row]",
  );
  if (!siblings) return undefined;
  const ids: string[] = [];
  siblings.forEach((r) => {
    const href = r
      .querySelector<HTMLAnchorElement>('a[href^="#/player/"]')
      ?.getAttribute("href");
    const id = href?.split("/")[2];
    if (id && !ids.includes(id)) ids.push(id);
  });
  return ids.length > 1 ? ids : undefined;
}

// The card itself: coloured header, four tabs, and left and right keys to step through the list it was opened from.
function CardView({
  m,
  start,
  list,
  startTab,
  scrollToChart,
  saveTab,
  addToVersus,
  close,
}: {
  m: Model;
  start: string;
  list?: string[];
  startTab: CardTab;
  scrollToChart: boolean;
  saveTab: (tab: CardTab) => void;
  addToVersus: (id: string) => void;
  close: () => void;
}) {
  const notify = useFeedback();
  const [id, setId] = useState(start),
    [tab, setTab] = useState<CardTab>(startTab),
    chart = useRef<HTMLDivElement>(null),
    swipe = useRef<{ x: number; y: number } | null>(null);
  const card = useMemo(() => playerCard(m, id), [m, id]),
    p = m.byId.get(id),
    at = list ? list.indexOf(id) : -1;
  const step = useCallback(
    (by: number) => {
      if (!list || at < 0) return;
      const next = list[at + by];
      if (next) {
        notify("tap");
        setId(next);
      }
    },
    [list, at, notify],
  );
  // The chart badge opens the card scrolled to the moving-average chart.
  useEffect(() => {
    if (scrollToChart) chart.current?.scrollIntoView({ block: "nearest" });
  }, [scrollToChart]);
  if (!card || !p)
    return (
      <div className="gd-popover-body">
        <h2>Player unavailable</h2>
        <p>This player is not in the current snapshot.</p>
      </div>
    );
  const h = card.header;
  return (
    <div
      className="gd-card-view"
      onTouchStart={(e) => {
        const t = e.touches[0];
        swipe.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const start = swipe.current,
          t = e.changedTouches[0];
        swipe.current = null;
        if (!start) return;
        const dx = t.clientX - start.x,
          dy = t.clientY - start.y;
        // A mostly sideways swipe steps to the next or previous player; a long downward swipe from the top closes the sheet.
        if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy))
          step(dx < 0 ? 1 : -1);
        else if (
          dy > 110 &&
          dy > 2 * Math.abs(dx) &&
          (e.currentTarget.closest(".gd-popover")?.scrollTop ?? 0) === 0
        )
          close();
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (isEditableTarget(e.target as HTMLElement)) return;
        e.preventDefault();
        step(e.key === "ArrowLeft" ? -1 : 1);
      }}
    >
      <header
        className="gd-card-head"
        style={{ backgroundColor: h.colors.background, color: h.colors.ink }}
      >
        <span className="gd-card-big" aria-hidden="true">
          {h.nfl}
        </span>
        <div className="gd-card-id">
          <PlayerPhoto player={p} size={72} className="gd-card-photo" />
          <div className="gd-card-id-text">
            <span className="gd-card-kicker">
              {h.pos} · {h.nfl} · {h.owner}
            </span>
            <h2>{h.name}</h2>
            <div className="gd-card-labels">
              {h.injury && h.injury.toUpperCase() !== "ACTIVE" && (
                <Chip tone="warning">{h.injury}</Chip>
              )}
              {h.labels.map((label) => (
                <Chip key={label} tone={labelTone(label)}>
                  {label}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        <div className="gd-card-nums">
          <div
            className="gd-card-stat gd-card-eppg"
            aria-label="Expected points per game"
          >
            <small>▲ EXPECTED PPG</small>
            <strong>{h.eppg ?? "—"}</strong>
            {h.floor !== null && h.ceiling !== null ? (
              <small>
                Floor {h.floor} · ceiling {h.ceiling}
              </small>
            ) : (
              <small title={h.rangeReason}>Range unavailable</small>
            )}
          </div>
          <div className="gd-card-stat">
            <small>● RECENT 3</small>
            <strong>{h.recent ?? "—"}</strong>
          </div>
          <div className="gd-card-stat">
            <small>▲ SURPLUS</small>
            <strong>{h.surplus ?? "—"}</strong>
          </div>
        </div>
        <div className="gd-card-actions">
          <button
            type="button"
            className="gd-card-versus"
            onClick={() => {
              notify("select");
              addToVersus(id);
            }}
          >
            Add to versus
          </button>
          {list && at >= 0 && (
            <div className="gd-card-step">
              <button
                type="button"
                aria-label="Previous player"
                disabled={at === 0}
                onClick={() => step(-1)}
              >
                ‹
              </button>
              <span aria-live="polite">
                {at + 1} of {list.length}
              </span>
              <button
                type="button"
                aria-label="Next player"
                disabled={at === list.length - 1}
                onClick={() => step(1)}
              >
                ›
              </button>
            </div>
          )}
        </div>
      </header>
      <div
        className="gd-tabs gd-ptabs"
        role="tablist"
        aria-label="Player card sections"
      >
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`gd-tab-${t}`}
            aria-selected={tab === t}
            aria-controls="gd-tabpanel"
            onClick={() => {
              notify("tap");
              setTab(t);
              saveTab(t);
            }}
          >
            {tabLabels[t]}
          </button>
        ))}
      </div>
      <div
        className="gd-tabpanel"
        id="gd-tabpanel"
        role="tabpanel"
        aria-labelledby={`gd-tab-${tab}`}
      >
        {tab === "story" && (
          <div className="gd-story-grid">
            <div className="gd-story-left">
              <NextRefreshScenarios m={m} p={p} defaultOpen />
              {h.blendLine && <small className="gd-blend">{h.blendLine}</small>}
              <ul className="gd-story">
                {card.story.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
            <div className="gd-story-right">
              <div
                ref={chart}
                className="gd-story-panel"
                role="region"
                aria-label={`Moving-average chart for ${h.name}`}
              >
                <span className="gd-kick">
                  Performance momentum &amp; moving averages
                </span>
                <PlayerStockChart
                  trend={card.chart.trend}
                  playerName={h.name}
                  position={h.pos}
                  leagueAvgVolume={card.chart.leagueAvgVolume}
                  height={200}
                />
              </div>
              <div className="gd-story-panel">
                <span className="gd-kick">Profile vs average {h.pos}</span>
                <Radar axes={card.radar} />
              </div>
            </div>
          </div>
        )}
        {tab === "numbers" && (
          <>
            {card.numbers.groups.map((g) => (
              <section
                key={g.provenance}
                className={`gd-numbers gd-${g.provenance}`}
              >
                <h3>
                  <span aria-hidden="true">{glyph[g.provenance]}</span>{" "}
                  {g.title}
                </h3>
                <dl>
                  {g.items.map((x) => (
                    <div key={x.label}>
                      <dt>{x.label}</dt>
                      <dd>{x.display}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
            <PlayerEvidence p={p} m={m} />
            {card.numbers.unavailable.length > 0 && (
              <details className="gd-unavailable">
                <summary>
                  Unavailable ({card.numbers.unavailable.length})
                </summary>
                <dl>
                  {card.numbers.unavailable.map((x) => (
                    <div key={x.label}>
                      <dt>{x.label}</dt>
                      <dd>— {x.reason}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
          </>
        )}
        {tab === "why" && <LabelWhy p={p} m={m} />}
        {tab === "calc" && (
          <>
            <ol className="gd-calc">
              {card.calculation.map((s) => (
                <li key={s.label}>
                  <span>
                    <b>{s.label}</b>
                    <small>{s.note}</small>
                  </span>
                  <strong>{s.display ?? "—"}</strong>
                </li>
              ))}
            </ol>
            <p className="gd-status">{card.status}</p>
          </>
        )}
      </div>
      <button type="button" className="gd-card-done" onClick={close}>
        Close
      </button>
    </div>
  );
}

const OpenPlayerContext = createContext<Opener | null>(null);

// Let any screen open the player card by id, optionally with the list it should step through.
export function useOpenPlayer(): Opener["openPlayer"] {
  const opener = useContext(OpenPlayerContext);
  return opener ? opener.openPlayer : () => {};
}

// Let a screen add a player to the comparison or reopen it.
export function useVersus(): Pick<Opener, "addToVersus" | "openVersus"> {
  const opener = useContext(OpenPlayerContext);
  return {
    addToVersus: opener ? opener.addToVersus : () => {},
    openVersus: opener ? opener.openVersus : () => {},
  };
}

// Open the one player card from anywhere; replaces the anchored popover while the preview is on.
export function PlayerCardProvider({
  m,
  lastTab,
  saveTab,
  versusRaw,
  saveVersus,
  children,
}: {
  m: Model | null;
  lastTab: CardTab;
  saveTab: (tab: CardTab) => void;
  // The saved comparison pair, as "idA,idB".
  versusRaw: string;
  saveVersus: (raw: string) => void;
  children: ReactNode;
}) {
  const popovers = usePopovers(),
    [active, setActive] = useState<string | null>(null),
    keyRef = useRef<number | null>(null),
    latest = useRef({ m, lastTab, saveTab, versusRaw, saveVersus });
  latest.current = { m, lastTab, saveTab, versusRaw, saveVersus };
  // Open the comparison for the two saved players; it stacks above any open card.
  const openVersus = useCallback(
    (ids?: string[]) => {
      const model = latest.current.m;
      const pair = ids ?? latest.current.versusRaw.split(",").filter(Boolean);
      if (!model || pair.length < 2) return;
      popovers.open({
        title: "Versus",
        width: 760,
        flush: true,
        render: (close) => (
          <VersusView m={model} start={[pair[0], pair[1]]} close={close} />
        ),
      });
    },
    [popovers],
  );
  const addVersus = useCallback(
    (id: string) => {
      const next = addToVersus(latest.current.versusRaw, id);
      latest.current.saveVersus(next.join(","));
      if (next.length === 2) openVersus(next);
    },
    [openVersus],
  );
  const openPlayer = useCallback(
    (id: string, list?: string[], target?: "chart", trigger?: string) => {
      const model = latest.current.m;
      if (!model) return;
      // Replacing a card must not look like the person closing it, so forget the old key first.
      if (keyRef.current !== null) {
        const old = keyRef.current;
        keyRef.current = null;
        popovers.close(old);
      }
      const name = model.byId.get(id)?.name ?? "Player";
      let mine = -1;
      mine = popovers.open({
        title: name,
        flush: true,
        onClose: () => {
          if (keyRef.current !== mine) return;
          keyRef.current = null;
          setActive(null);
          // A card opened from a #/player/ address returns that address to This week when it closes.
          if (location.hash.startsWith("#/player/"))
            location.hash = "#/overview";
        },
        render: (close) => (
          <CardView
            m={model}
            start={id}
            list={list}
            startTab={target === "chart" ? "story" : latest.current.lastTab}
            scrollToChart={target === "chart"}
            saveTab={(t) => latest.current.saveTab(t)}
            addToVersus={(pid) => addVersus(pid)}
            close={close}
          />
        ),
      });
      keyRef.current = mine;
      setActive(trigger ?? id);
    },
    [popovers],
  );
  // Never keep a card from another snapshot open.
  const seenHash = useRef(m?.dataset.hash);
  useEffect(() => {
    // Mounting, or the first model arriving, is not a change; only one snapshot replacing another closes the card.
    const previous = seenHash.current;
    if (previous === m?.dataset.hash) return;
    seenHash.current = m?.dataset.hash;
    if (previous !== undefined && keyRef.current !== null) {
      const key = keyRef.current;
      keyRef.current = null;
      popovers.close(key);
      setActive(null);
    }
  }, [m?.dataset.hash, popovers]);
  const opener = useMemo(
    () => ({
      openPlayer: (id: string, list?: string[]) => openPlayer(id, list),
      addToVersus: addVersus,
      openVersus: () => openVersus(),
    }),
    [openPlayer, addVersus, openVersus],
  );
  const context = useMemo(
    () => ({
      activeTrigger: active,
      open: (
        id: string,
        anchor: HTMLElement,
        trigger: string,
        target?: "chart",
      ) => openPlayer(id, listFromAnchor(anchor), target, trigger),
    }),
    [active, openPlayer],
  );
  return (
    <OpenPlayerContext.Provider value={opener}>
      <PlayerPopoverContext.Provider value={context}>
        {children}
      </PlayerPopoverContext.Provider>
    </OpenPlayerContext.Provider>
  );
}

// Open the card for the player in a #/player/:id route and send the address back to This week when it closes.
export function PlayerRouteOpener({
  route,
  ready,
}: {
  route: string;
  // The card can open only once the model has loaded, so a fresh page load with a player address still opens it.
  ready: boolean;
}) {
  const [head, id] = route.split("/"),
    openPlayer = useOpenPlayer();
  useEffect(() => {
    if (head !== "player" || !id || !ready) return;
    openPlayer(id);
    // Open once per route change, not when the opener function is recreated.
  }, [head, id, ready]);
  return null;
}
