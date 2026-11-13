import { useId, useMemo, useState } from "react";
import { versus } from "../../domain/view/versus";
import type { Model, Player } from "../../domain/valuation";
import { isEditableTarget } from "../../ui/popover/keys";
import { useFeedback } from "../../ui/feel/feedback";
import { PlayerPhoto } from "../../ui/PlayerPhoto";

const label = (p: Player) => `${p.name} · ${p.pos} · ${p.nfl}`;

// Pick one side by typing a name; only an exact suggestion changes the player, so half-typed text never does.
function Picker({
  m,
  side,
  current,
  change,
}: {
  m: Model;
  side: string;
  current: Player | undefined;
  change: (id: string) => void;
}) {
  const notify = useFeedback();
  const list = useId(),
    [text, setText] = useState("");
  return (
    <label className="gd-versus-pick">
      <span>Change {side} player</span>
      <input
        list={list}
        aria-label={`Change ${side} player`}
        placeholder={current ? label(current) : "Search players"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const hit = m.players.find((p) => label(p) === e.target.value);
          if (hit) {
            notify("select");
            change(hit.id);
            setText("");
          }
        }}
      />
      <datalist id={list}>
        {m.players.map((p) => (
          <option key={p.id} value={label(p)} />
        ))}
      </datalist>
    </label>
  );
}

// Two players side by side with mirrored bars; the left and right keys swap the sides.
export function VersusView({
  m,
  start,
  close,
}: {
  m: Model;
  start: [string, string];
  close: () => void;
}) {
  const notify = useFeedback();
  const [ids, setIds] = useState<[string, string]>(start);
  const result = useMemo(() => versus(m, ids[0], ids[1]), [m, ids]);
  const swap = () => {
    notify("select");
    setIds([ids[1], ids[0]]);
  };
  if (!result)
    return (
      <div className="gd-popover-body">
        <h2>Versus</h2>
        <p>One of these players is not in the current snapshot.</p>
        <button type="button" className="gd-card-done" onClick={close}>
          Close
        </button>
      </div>
    );
  const { a, b, rows } = result;
  return (
    <div
      className="gd-versus"
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        if (isEditableTarget(e.target as HTMLElement)) return;
        e.preventDefault();
        swap();
      }}
    >
      <header className="gd-versus-head">
        {[a, b].map((s, i) => (
          <div
            key={`${s.id}-${i}`}
            className="gd-versus-side"
            style={{ background: s.colors.background, color: s.colors.ink }}
          >
            {/* Each comparison side uses the same translucent full-size portrait. */}
            <span className="gd-versus-photo"><PlayerPhoto player={{ id: s.id, name: s.name, pos: s.pos, nfl: s.nfl }} size="fill" /></span>
            <div className="gd-versus-side-text">
              <small>
                {s.pos} · {s.nfl}
              </small>
              <h2>{s.name}</h2>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="gd-versus-swap"
          aria-label="Swap sides"
          onClick={swap}
        >
          ⇄
        </button>
      </header>
      <div className="gd-versus-rows">
        {rows.map((r) => (
          <div key={r.label} className="gd-versus-row">
            <span
              className={`gd-versus-val${r.better === "a" ? " better" : ""}`}
            >
              {r.a ?? "—"}
            </span>
            <span className="gd-versus-bar a" aria-hidden="true">
              {r.aShare !== null && (
                <i style={{ width: `${r.aShare * 100}%` }} />
              )}
            </span>
            <b>{r.label}</b>
            <span className="gd-versus-bar b" aria-hidden="true">
              {r.bShare !== null && (
                <i style={{ width: `${r.bShare * 100}%` }} />
              )}
            </span>
            <span
              className={`gd-versus-val${r.better === "b" ? " better" : ""}`}
            >
              {r.b ?? "—"}
            </span>
          </div>
        ))}
      </div>
      {result.odds ? (
        <section className="gd-odds" aria-label="Start or sit odds">
          <h3>Start or sit</h3>
          <p className="gd-odds-line">
            <b>{a.name}</b> {result.odds.a} · <b>{b.name}</b> {result.odds.b}
          </p>
          <p>
            That is {result.odds.reading} for the chance of outscoring each
            other this week.
          </p>
          <small>{result.odds.ranges}</small>
          <small>{result.odds.caveat}</small>
        </section>
      ) : (
        <p className="gd-muted">
          {result.unavailableReason ||
            "Start or sit odds need an MPPG and a spread for both players."}
        </p>
      )}
      <div className="gd-versus-pickers">
        <Picker
          m={m}
          side="left"
          current={m.byId.get(ids[0])}
          change={(id) => setIds([id, ids[1]])}
        />
        <Picker
          m={m}
          side="right"
          current={m.byId.get(ids[1])}
          change={(id) => setIds([ids[0], id])}
        />
      </div>
      <p className="gd-versus-note">
        Higher is better on every row. A dash means the value is unavailable,
        not zero. Press left or right arrow to swap sides.
      </p>
      <button type="button" className="gd-card-done" onClick={close}>
        Close
      </button>
    </div>
  );
}
