import { hapticsSupported } from "./settings";

// The three card entrances: what is heard and felt, as data so tests can pin it. The pictures live in player-hero.css.
export type EntranceTier = "superstar" | "star" | "good";

// Nine camera flashes at scattered points, in the order and at the moments the shutter clicks sound.
export const paparazziFlashes = [
  { left: 14, top: 24, size: 150, delayS: 0.06 },
  { left: 71, top: 18, size: 120, delayS: 0.19 },
  { left: 38, top: 70, size: 170, delayS: 0.32 },
  { left: 86, top: 62, size: 140, delayS: 0.61 },
  { left: 55, top: 30, size: 190, delayS: 0.76 },
  { left: 22, top: 58, size: 130, delayS: 1.05 },
  { left: 64, top: 78, size: 150, delayS: 1.18 },
  { left: 8, top: 82, size: 110, delayS: 1.3 },
  { left: 92, top: 30, size: 120, delayS: 1.42 },
] as const;

// One shutter: a short band-passed noise click, then a quieter second click 45 ms later, like a mirror slap.
export const shutterClicks = [
  { offsetMs: 0, hz: 3600, gain: 0.08 },
  { offsetMs: 45, hz: 2400, gain: 0.05 },
] as const;

interface Cue {
  // When each sound and tick plays, in milliseconds after the entrance starts.
  at: number[];
  // A tone, or null when the cue is the shutter noise.
  tone: { fromHz: number; toHz: number; ms: number } | null;
}

export const entranceCues: Record<EntranceTier, Cue> = {
  superstar: {
    at: paparazziFlashes.map((f) => Math.round(f.delayS * 1000)),
    tone: null,
  },
  star: { at: [250], tone: { fromHz: 1400, toHz: 2800, ms: 400 } },
  good: { at: [300], tone: { fromHz: 2093, toHz: 2093, ms: 140 } },
};

// Milliseconds of vibration per cue; zero means none.
export const vibrationFor = (tier: EntranceTier): number =>
  ({ superstar: 8, star: 12, good: 0 })[tier];

let audio: AudioContext | undefined;

function context(): AudioContext | undefined {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return undefined;
    audio ??= new Ctx();
    return audio;
  } catch {
    return undefined;
  }
}

function shutter(ac: AudioContext) {
  const start = ac.currentTime;
  for (const click of shutterClicks) {
    const length = Math.floor(ac.sampleRate * 0.03);
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    const source = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const gain = ac.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = click.hz;
    gain.gain.value = click.gain;
    source.connect(filter).connect(gain).connect(ac.destination);
    source.start(start + click.offsetMs / 1000);
  }
}

function tone(
  ac: AudioContext,
  t: { fromHz: number; toHz: number; ms: number },
  peak: number,
) {
  const start = ac.currentTime;
  const end = start + t.ms / 1000;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(t.fromHz, start);
  if (t.toHz !== t.fromHz)
    osc.frequency.exponentialRampToValueAtTime(t.toHz, end);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

// Play the sound and haptics of one entrance, each only if its own Feel switch is on. Returns a function that cancels what is still pending.
export function playEntrance(
  tier: EntranceTier,
  settings: { sound: boolean; haptics: boolean },
): () => void {
  const timers: number[] = [];
  const cue = entranceCues[tier];
  for (const at of cue.at)
    timers.push(
      window.setTimeout(() => {
        if (settings.sound) {
          try {
            const ac = context();
            if (ac) {
              if (cue.tone) tone(ac, cue.tone, tier === "star" ? 0.03 : 0.02);
              else shutter(ac);
            }
          } catch {
            // Audio can be blocked until a gesture; the entrance is never essential.
          }
        }
        const ms = vibrationFor(tier);
        if (settings.haptics && ms > 0 && hapticsSupported())
          try {
            navigator.vibrate(ms);
          } catch {
            // Vibration can be refused by the browser.
          }
      }, at),
    );
  return () => timers.forEach((t) => window.clearTimeout(t));
}
