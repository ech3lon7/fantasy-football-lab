import { useFeedback } from "../../ui/feel/feedback";
import {
  chainPresets,
  chainPresetDescriptions,
} from "../../domain/chain-discovery";

// The ten chain presets as cards with a plain description; a preset only describes the kind of chain to look for.
export function PresetCards({
  selected,
  choose,
}: {
  selected: string;
  choose: (id: string) => void;
}) {
  const notify = useFeedback();
  return (
    <div className="gd-presets" role="group" aria-label="Chain presets">
      {chainPresets.map((p) => (
        <button
          key={p.id}
          type="button"
          className="gd-preset"
          aria-pressed={selected === p.id}
          onClick={() => {
            notify("select");
            choose(p.id);
          }}
        >
          <b>{p.label}</b>
          <small>{chainPresetDescriptions[p.id]}</small>
        </button>
      ))}
    </div>
  );
}
