import type {
  VoiceChangerConfig,
  VoiceChangerPatch,
  VoicePresetName,
} from "./types";

/** Neutral configuration — everything off / unison. */
export const defaultConfig: VoiceChangerConfig = {
  enabled: true,
  pitch: 0,
  drive: 0,
  ring: { hz: 0, mix: 0 },
  vibrato: { hz: 0, depth: 0 },
  tone: { highpass: 0, lowpass: 0 },
  mix: 1,
  gain: 1,
};

export interface VoicePreset {
  label: string;
  hint: string;
  config: VoiceChangerConfig;
}

/** Build a full config from a sparse patch (unspecified fields stay neutral). */
function voice(p: VoiceChangerPatch): VoiceChangerConfig {
  return {
    enabled: p.enabled ?? true,
    pitch: p.pitch ?? 0,
    drive: p.drive ?? 0,
    ring: { hz: p.ring?.hz ?? 0, mix: p.ring?.mix ?? 0 },
    vibrato: { hz: p.vibrato?.hz ?? 0, depth: p.vibrato?.depth ?? 0 },
    tone: { highpass: p.tone?.highpass ?? 0, lowpass: p.tone?.lowpass ?? 0 },
    mix: p.mix ?? 1,
    gain: p.gain ?? 1,
  };
}

/**
 * Ready-to-use presets. Each is a full {@link VoiceChangerConfig}, so applying
 * one fully replaces the live settings.
 *
 * The pitch shifter moves pitch and timbre together, so a preset evokes a
 * character / age rather than reproducing a specific person. The 25/30/35 steps
 * are intentionally subtle (voices change little across that range).
 */
export const presets: Record<VoicePresetName, VoicePreset> = {
  clean: {
    label: "Clean",
    hint: "Bypass — your natural voice",
    config: voice({ enabled: false }),
  },

  // ---- Female ---------------------------------------------------------
  female: {
    label: "Female",
    hint: "Higher pitch, brighter tone",
    config: voice({ pitch: 5, tone: { highpass: 150, lowpass: 0 } }),
  },
  female2: {
    label: "Female 2",
    hint: "Lighter, airier female",
    config: voice({ pitch: 6, tone: { highpass: 200, lowpass: 0 } }),
  },
  "female-18": {
    label: "Female 18",
    hint: "Young woman, bright",
    config: voice({ pitch: 6, tone: { highpass: 170, lowpass: 0 } }),
  },
  "female-25": {
    label: "Female 25",
    hint: "Adult woman",
    config: voice({ pitch: 5, tone: { highpass: 150, lowpass: 0 } }),
  },
  "female-30": {
    label: "Female 30",
    hint: "Adult woman, warmer",
    config: voice({ pitch: 4, tone: { highpass: 120, lowpass: 13000 } }),
  },
  "female-35": {
    label: "Female 35",
    hint: "Mature woman, full and warm",
    config: voice({ pitch: 3, tone: { highpass: 100, lowpass: 11000 } }),
  },
  "old-lady": {
    label: "Old lady",
    hint: "Elderly woman, thin and wavery",
    config: voice({
      pitch: 2,
      drive: 0.05,
      vibrato: { hz: 7, depth: 0.4 },
      tone: { highpass: 200, lowpass: 8000 },
    }),
  },

  // ---- Male -----------------------------------------------------------
  male: {
    label: "Male",
    hint: "Deeper pitch, warmer tone",
    config: voice({ pitch: -5, tone: { highpass: 0, lowpass: 7000 }, gain: 1.05 }),
  },
  male2: {
    label: "Male 2",
    hint: "Deeper, fuller male",
    config: voice({
      pitch: -6,
      drive: 0.05,
      tone: { highpass: 0, lowpass: 6000 },
      gain: 1.05,
    }),
  },
  "male-18": {
    label: "Male 18",
    hint: "Young man, brighter",
    config: voice({ pitch: -2, tone: { highpass: 0, lowpass: 9500 } }),
  },
  "male-25": {
    label: "Male 25",
    hint: "Adult man",
    config: voice({ pitch: -4, tone: { highpass: 0, lowpass: 8000 }, gain: 1.05 }),
  },
  "male-30": {
    label: "Male 30",
    hint: "Adult man, deep and full",
    config: voice({ pitch: -6, tone: { highpass: 0, lowpass: 6800 }, gain: 1.05 }),
  },
  "male-35": {
    label: "Male 35",
    hint: "Mature man, deepest",
    config: voice({ pitch: -7, tone: { highpass: 0, lowpass: 6000 }, gain: 1.05 }),
  },
  "old-man": {
    label: "Old man",
    hint: "Elderly man, deep and gravelly",
    config: voice({
      pitch: -6,
      drive: 0.15,
      vibrato: { hz: 6, depth: 0.5 },
      tone: { highpass: 0, lowpass: 5500 },
    }),
  },

  // ---- Kids -----------------------------------------------------------
  "child-5": {
    label: "Kid (5)",
    hint: "Small child, very high",
    config: voice({ pitch: 12, tone: { highpass: 250, lowpass: 0 } }),
  },
  "girl-10": {
    label: "Girl (10)",
    hint: "Young girl, high and bright",
    config: voice({ pitch: 8, tone: { highpass: 220, lowpass: 0 } }),
  },
  "boy-10": {
    label: "Boy (10)",
    hint: "Young boy, high",
    config: voice({ pitch: 6, tone: { highpass: 180, lowpass: 10000 } }),
  },

  // ---- Characters -----------------------------------------------------
  robot: {
    label: "Robot",
    hint: "Ring-modulated metallic monotone",
    config: voice({
      pitch: 0,
      drive: 0.25,
      ring: { hz: 55, mix: 0.85 },
      tone: { highpass: 0, lowpass: 5000 },
    }),
  },
  alien: {
    label: "Alien",
    hint: "High pitch, ring mod and a shimmering wobble",
    config: voice({
      pitch: 7,
      ring: { hz: 180, mix: 0.5 },
      vibrato: { hz: 6, depth: 0.6 },
      tone: { highpass: 200, lowpass: 0 },
    }),
  },
  villain: {
    label: "Villain",
    hint: "Heavy bass, distorted, menacing",
    config: voice({
      pitch: -9,
      drive: 0.5,
      ring: { hz: 30, mix: 0.25 },
      tone: { highpass: 0, lowpass: 4500 },
      gain: 1.1,
    }),
  },
};

export const presetNames = Object.keys(presets) as VoicePresetName[];
