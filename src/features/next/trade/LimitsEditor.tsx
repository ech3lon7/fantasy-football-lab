import {
  editedLimits,
  limitLabels,
  type LimitName,
  type SearchLimits,
} from "../../../domain/search-limits";
import { limitText } from "../../../domain/view/limits";

interface Slider {
  name: LimitName;
  label: string;
  min: number;
  max: number;
  step: number;
  // Convert between the stored value and the slider position.
  toSlider: (limits: SearchLimits) => number;
  fromSlider: (value: number, limits: SearchLimits) => SearchLimits;
}

const sliders: Slider[] = [
  {
    name: "minimumFinalGain",
    label: "Minimum final gain",
    min: 0,
    max: 10,
    step: 0.5,
    toSlider: (l) => l.minimumFinalGain,
    fromSlider: (v, l) => ({ ...l, minimumFinalGain: v }),
  },
  {
    name: "maximumTemporaryLoss",
    label: "Maximum temporary loss",
    min: 0,
    max: 10,
    step: 0.5,
    toSlider: (l) => l.maximumTemporaryLoss,
    fromSlider: (v, l) => ({ ...l, maximumTemporaryLoss: v }),
  },
  {
    name: "maximumRecipientValueLoss",
    label: "Maximum recipient value loss",
    min: 0,
    max: 50,
    step: 1,
    toSlider: (l) => Math.round(l.maximumRecipientValueLoss * 100),
    fromSlider: (v, l) => ({ ...l, maximumRecipientValueLoss: v / 100 }),
  },
  {
    name: "indexWindow",
    label: "Index window",
    min: 0,
    max: 30,
    step: 1,
    toSlider: (l) => l.indexWindow ?? 0,
    fromSlider: (v, l) => ({ ...l, indexWindow: v === 0 ? null : v }),
  },
];

// The four shared limits as sliders with an "edited" marker on each changed one; one set for Find trades and the Chain planner.
export function LimitsEditor({
  limits,
  update,
  reset,
}: {
  limits: SearchLimits;
  update: (next: SearchLimits) => void;
  reset: () => void;
}) {
  const edited = editedLimits(limits);
  return (
    <>
      {sliders.map((s) => (
        <label key={s.name} className="gd-limit">
          <span>
            {limitLabels[s.name]} · <b>{limitText(s.name, limits)}</b>
            {edited.includes(s.name) && (
              <span className="gd-edot" title="Differs from the default" />
            )}
          </span>
          <input
            type="range"
            aria-label={limitLabels[s.name]}
            min={s.min}
            max={s.max}
            step={s.step}
            value={s.toSlider(limits)}
            onChange={(e) =>
              update(s.fromSlider(Number(e.target.value), limits))
            }
          />
        </label>
      ))}
      <p className="gd-quiet">
        One set for Find trades and the Chain planner. Presets never change
        these and saved presets do not store them. If a search finds nothing it
        widens from these values and tags the results with what moved.
      </p>
      <button
        type="button"
        className="gd-cbtn"
        disabled={edited.length === 0}
        onClick={reset}
      >
        Reset to defaults
      </button>
    </>
  );
}
