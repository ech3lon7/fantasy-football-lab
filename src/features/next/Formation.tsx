import { useMemo, useState, type CSSProperties } from "react";
import {
  formationLineup,
  formationView,
  type BackupView,
  type FormationView,
  type SlotCardView,
} from "../../domain/view/formation";
import {
  optimizeLineup,
  pinBlocker,
  type OptimizeResult,
} from "../../domain/lineup-optimizer";
import { clearPins, lineupPinsKey, pinsFor, setPin } from "../../domain/lineup-pins";
import { Pin } from "lucide-react";
import { starterLineupsKey } from "../../domain/starter-lineups";
import { teamColors } from "../../domain/view/nfl-colors";
import type { PositionGrade } from "../../domain/lineups";
import type { Model, Player } from "../../domain/valuation";
import { useFeedback } from "../../ui/feel/feedback";
import { GradeBadge } from "../../ui/GradeBadge";
import { PlayerName } from "../../ui/PlayerName";
import { PlayerPhoto } from "../../ui/PlayerPhoto";

// The field is the same dark turf in both themes; only the page around it follows the theme.
function FieldPhoto({ player }: { player: Player }) {
  const colors = teamColors(player.nfl);
  return (
    <span
      className="gd-fc-av"
      style={{ background: colors.background, color: colors.ink }}
    >
      <PlayerPhoto player={player} size="fill" className="gd-fc-photo" />
    </span>
  );
}

// Pins are workspace preferences; buttons stay available to explain why an unavailable player cannot be pinned.
function PinButton({ player, pinned, onToggle, backup = false }: {
  player: Player;
  pinned: boolean;
  onToggle: (id: string) => void;
  backup?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${backup ? "gd-fb-pin" : "gd-fc-pin"}${pinned ? " on" : ""}`}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${player.name}` : `Pin ${player.name}: Optimize will always start him`}
      onClick={() => onToggle(player.id)}
    >
      <Pin aria-hidden="true" />
    </button>
  );
}

function BackupRow({
  backup,
  player,
  pinned,
  onPin,
}: {
  backup: BackupView;
  player: Player | null;
  pinned: boolean;
  onPin: (id: string) => void;
}) {
  return (
    <div
      className={`gd-fc-bk gd-fb-${backup.tone}${backup.empty ? " gd-fb-none" : ""}`}
    >
      {backup.empty || !player ? (
        <span className="gd-fc-bkn">No backup</span>
      ) : (
        <>
          <PinButton player={player} pinned={pinned} onToggle={onPin} backup />
          <PlayerName
            p={player}
            className="gd-fc-bkn"
            ariaLabel={`${backup.fullName}, MPPG ${backup.mppgText}`}
          >
            {/* Desktop shows the condensed short name; the phone layout shows the last name. */}
            <span className="gd-fc-bkn-short">{backup.shortName}</span>
            <span className="gd-fc-bkn-last">{backup.lastName}</span>
          </PlayerName>
          <b>{backup.mppgText}</b>
        </>
      )}
    </div>
  );
}

function SlotCard({
  card,
  m,
  isNew,
  onCut,
  pins,
  onPin,
}: {
  card: SlotCardView;
  m: Model;
  isNew: boolean;
  onCut?: (id: string) => void;
  pins: string[];
  onPin: (id: string) => void;
}) {
  const player = card.playerId ? (m.byId.get(card.playerId) ?? null) : null;
  return (
    <article className={`gd-fc gd-fc-${card.tone}${isNew ? " gd-fc-new" : ""}`}>
      <div className="gd-fc-ph">
        {player && <PinButton player={player} pinned={pins.includes(player.id)} onToggle={onPin} />}
        <span className="gd-fc-badge" title={card.buildLine || undefined}>
          <b>{card.mppgText}</b>
          <small>MPPG</small>
        </span>
        {card.flexPos && <span className="gd-fc-flex">{card.flexPos}</span>}
        {player ? (
          <FieldPhoto player={player} />
        ) : (
          <span className="gd-fc-av gd-fc-av-empty">—</span>
        )}
        {card.matchupLine && (
          <span className="gd-fc-mu">{card.matchupLine}</span>
        )}
        {isNew && <span className="gd-fc-newtag">▲ In</span>}
      </div>
      {player ? (
        <PlayerName
          p={player}
          className="gd-fc-nm"
          ariaLabel={card.accessibleName}
        >
          {card.shortName}
        </PlayerName>
      ) : (
        <span className="gd-fc-nm" aria-label={card.accessibleName}>
          {card.shortName}
        </span>
      )}
      {card.backups.map((backup, index) => (
        <BackupRow
          key={index}
          backup={backup}
          pinned={!!backup.playerId && pins.includes(backup.playerId)}
          onPin={onPin}
          player={
            backup.playerId ? (m.byId.get(backup.playerId) ?? null) : null
          }
        />
      ))}
      {onCut && player && (
        <button
          type="button"
          className="gd-fc-cut"
          aria-label={`Cut ${card.fullName} from simulation`}
          title={`Cut ${card.fullName} from simulation`}
          onClick={() => onCut(player.id)}
        >
          Cut
        </button>
      )}
    </article>
  );
}

// One slot wrapper: the field grid column comes from the view model, and the media queries clear it.
function Slot({
  card,
  m,
  index,
  isNew,
  onCut,
  pins,
  onPin,
}: {
  card: SlotCardView;
  m: Model;
  index: number;
  isNew: boolean;
  onCut?: (id: string) => void;
  pins: string[];
  onPin: (id: string) => void;
}) {
  return (
    <div
      className="gd-fs"
      data-slot={card.slot}
      data-label={card.label}
      style={
        {
          "--gd-col": card.column,
          "--gd-stagger": index,
        } as CSSProperties
      }
    >
      <SlotCard card={card} m={m} isNew={isNew} onCut={onCut} pins={pins} onPin={onPin} />
      <div className="gd-fs-lab">
        <b>{card.label}</b>
        <GradeBadge grade={card.grade} tone={card.gradeTone} />
      </div>
    </div>
  );
}

function FormationKey() {
  return (
    <div className="gd-fm-key">
      <b>This week's lineup</b>
      <span>
        Shows your ESPN lineup. Optimize swaps in the highest-MPPG starters;
        pin a player to keep him starting. Under each card, the next two
        players who would fill the slot.
      </span>
      <span className="gd-fm-sw">
        <i className="gd-fc-good" />
        Good matchup
      </span>
      <span className="gd-fm-sw">
        <i className="gd-fc-mid" />
        Neutral
      </span>
      <span className="gd-fm-sw">
        <i className="gd-fc-bad" />
        Bad matchup
      </span>
      <span className="gd-fm-sw">
        <i className="gd-fc-out" />
        Bye / out
      </span>
    </div>
  );
}

function signed(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

// The line matches E10.7: "Start Marquise Dunn at FLEX over Cole Brannigan +1.9".
function changeLine(
  change: OptimizeResult["changes"][number],
  label: string,
) {
  const start = change.outName
    ? `Start ${change.inName} at ${label} over ${change.outName}`
    : `Start ${change.inName} at ${label}`;
  return `${start}${change.pinned ? " (pinned)" : ""} ${signed(change.gain)}`;
}

function FormationBar({
  view,
  optimized,
  preview,
  labels,
  onOptimize,
  onUndo,
  onCopy,
  pins,
  pinNames,
  conflictNames,
  onClearPins,
}: {
  view: FormationView;
  optimized: OptimizeResult | null;
  preview: OptimizeResult;
  labels: Map<number, string>;
  onOptimize: () => void;
  onUndo: () => void;
  onCopy: () => void;
  pins: string[];
  pinNames: string[];
  conflictNames: string[];
  onClearPins: () => void;
}) {
  const canOptimize = preview.changes.length > 0 && preview.conflicts.length === 0;
  const label = optimized ? "Optimized lineup" : view.source;
  return (
    <div className="gd-fm-bar">
      <div className="gd-fm-tot">
        <small>{label} · MPPG</small>
        <b>{view.total.toFixed(1)}</b>
        <span>± {view.spread.toFixed(1)}</span>
      </div>
      {optimized ? (
        <>
          <div className="gd-fm-res">
            <b>
              {signed(optimized.gain)} MPPG this week ·{" "}
              {optimized.currentTotal.toFixed(1)} →{" "}
              {optimized.optimizedTotal.toFixed(1)}
            </b>
            {optimized.changes.map((change) => (
              <span
                key={`${change.slotIndex}/${change.inId}`}
                className="gd-fm-ch"
              >
                {changeLine(
                  change,
                  labels.get(change.slotIndex) ?? change.slot,
                )}
              </span>
            ))}
            <span className="gd-fm-note">
              Set these in ESPN; this app never changes your ESPN lineup.
            </span>
          </div>
          <div className="gd-fm-acts">
            <button type="button" className="gd-fm-opt gd-fm-ghost" onClick={onCopy}>
              Copy changes
            </button>
            <button type="button" className="gd-fm-opt gd-fm-ghost" onClick={onUndo}>
              Undo
            </button>
          </div>
        </>
      ) : (
        <>
          <span className="gd-fm-hint">
            {preview.conflicts.length
              ? `Conflicting pins: ${conflictNames.join(", ")}.`
              : canOptimize
              ? `Optimizing gains ${signed(preview.gain)} MPPG with ${preview.changes.length} ${preview.changes.length === 1 ? "change" : "changes"}.`
              : "Already your highest-MPPG lineup."}
          </span>
          <button
            type="button"
            className="gd-fm-opt"
            disabled={!canOptimize}
            onClick={onOptimize}
          >
            {canOptimize || preview.conflicts.length ? "⚡ Optimize lineup" : "✓ Lineup is optimal"}
          </button>
        </>
      )}
      {pins.length > 0 && (
        <div className="gd-fm-pins">
          <Pin aria-hidden="true" />
          <span>
            {pins.length} pinned: {pinNames.join(", ")}. Optimize always starts them.
            {preview.pinCost !== null && ` Pins cost ${preview.pinCost.toFixed(1)} MPPG against the unpinned best.`}
          </span>
          <button type="button" onClick={onClearPins}>Clear pins</button>
        </div>
      )}
    </div>
  );
}

// The Roster formation: Optimize bar, then the two field rows, the line of scrimmage, the key and special teams.
export function Formation({
  m,
  team,
  grades,
  filters,
  onFilters,
  onCut,
}: {
  m: Model;
  team: string;
  grades: PositionGrade[];
  filters: Record<string, string>;
  onFilters: (patch: Record<string, string>) => void;
  onCut?: (id: string) => void;
}) {
  const notify = useFeedback();
  // Hypothetical scenarios carry their own starter selections; live rosters use the saved app selection.
  const raw = m.simulation ? m.simulation.lineupsRaw : filters[starterLineupsKey];
  const pinsRaw = filters[lineupPinsKey];
  const pins = useMemo(() => pinsFor(pinsRaw, team, m.current), [pinsRaw, team, m.current]);
  const base = useMemo(
    () => formationLineup(m, team, raw),
    [m, team, raw],
  );
  const preview = useMemo(
    () => optimizeLineup(m, team, { current: base.lineup, pins }),
    [m, team, base, pins],
  );
  // The optimized result is view state only; the component's key resets it on a new import or simulation.
  const [optimized, setOptimized] = useState<OptimizeResult | null>(null);
  const [toast, setToast] = useState("");
  const lineup = optimized ? optimized.slots : base.lineup;
  const view = useMemo(
    () => formationView(m, team, grades, lineup, base.source),
    [m, team, grades, lineup, base.source],
  );
  const labels = new Map(
    view.cards.map((card) => [card.index, card.label] as const),
  );
  const changed = new Set(
    optimized ? optimized.changes.map((change) => change.slotIndex) : [],
  );
  const copyLines = optimized
    ? optimized.changes.map((change) =>
        changeLine(
          change,
          labels.get(change.slotIndex) ?? change.slot,
        ),
      )
    : [];
  const line = view.cards.filter((card) => card.row === 1),
    back = view.cards.filter(
      (card) =>
        card.row === 2 && card.slot !== "K" && card.slot !== "D/ST",
    ),
    special = view.cards.filter(
      (card) => card.slot === "K" || card.slot === "D/ST",
    );

  function optimize() {
    setOptimized(preview);
    setToast("");
    notify("success");
  }

  // Reject unavailable pins with a visible reason and save valid selections only in workspace filters.
  function togglePin(id: string) {
    const reason = pinBlocker(m, team, id);
    if (!pins.includes(id) && reason) {
      setToast(`${m.byId.get(id)?.name ?? id} has no MPPG this week (${reason}), so he cannot be pinned.`);
      notify("caution");
      return;
    }
    onFilters({ [lineupPinsKey]: setPin(pinsRaw, team, m.current, id, !pins.includes(id)) });
    setOptimized(null);
    setToast("");
    notify("select");
  }

  function undo() {
    setOptimized(null);
    setToast("");
  }

  function copy() {
    const text = copyLines.join("\n");
    const write = navigator.clipboard?.writeText(text);
    if (!write) {
      setToast(`Clipboard unavailable. ${copyLines.join(" ")}`);
      return;
    }
    // Confirm copying only after the browser accepts the clipboard write.
    void write.then(() => setToast("Change lines copied.")).catch(() => {
      setToast(`Clipboard unavailable. ${copyLines.join(" ")}`);
    });
  }

  return (
    <>
      {base.errors.length > 0 && (
        <p className="gd-fm-error">{base.errors.join(" ")}</p>
      )}
      <div
        className={`gd-fm${optimized ? " gd-fm-optimized" : ""}`}
        role="group"
        aria-label="This week's lineup in formation"
      >
        <div
          onKeyDown={(event) => {
            if (event.key === "Escape" && optimized) {
              event.stopPropagation();
              undo();
            }
          }}
        >
          <FormationBar
            view={view}
            optimized={optimized}
            preview={preview}
            labels={labels}
            onOptimize={optimize}
            onUndo={undo}
            onCopy={copy}
            pins={pins}
            pinNames={pins.map((id) => m.byId.get(id)?.name.split(" ").slice(-1)[0] ?? id)}
            conflictNames={preview.conflicts.map((id) => m.byId.get(id)?.name ?? id)}
            onClearPins={() => {
              onFilters({ [lineupPinsKey]: clearPins(pinsRaw, team) });
              setOptimized(null);
              setToast("");
            }}
          />
          {toast && (
            <p role="status" className="gd-fm-toast">
              {toast}
            </p>
          )}
        </div>
        <div className="gd-fm-line">
          {line.map((card, index) => (
            <Slot
              key={card.label}
              card={card}
              m={m}
              index={index}
              isNew={changed.has(card.index)}
              onCut={onCut}
              pins={pins}
              onPin={togglePin}
            />
          ))}
        </div>
        <div className="gd-fm-los" aria-hidden="true" />
        <div className="gd-fm-back">
          <FormationKey />
          {back.map((card, index) => (
            <Slot
              key={card.label}
              card={card}
              m={m}
              index={line.length + index}
              isNew={changed.has(card.index)}
              onCut={onCut}
              pins={pins}
              onPin={togglePin}
            />
          ))}
          <div className="gd-fm-st">
            <span className="gd-fm-st-h">Special teams</span>
            <div className="gd-fm-st-row">
              {special.map((card, index) => (
                <Slot
                  key={card.label}
                  card={card}
                  m={m}
                  index={line.length + back.length + index}
                  isNew={changed.has(card.index)}
                  onCut={onCut}
                  pins={pins}
                  onPin={togglePin}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
