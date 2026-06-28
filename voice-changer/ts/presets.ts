import type { VoiceChangerConfig, VoicePresetName } from "./types";

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

/**
 * Ready-to-use character presets. Each is a full {@link VoiceChangerConfig}, so
 * applying one fully replaces the live settings.
 */
export const presets: Record<VoicePresetName, VoicePreset> = {
  clean: {
    label: "Clean",
    hint: "Bypass — your natural voice",
    config: { ...defaultConfig, enabled: false },
  },
  female: {
    label: "Female",
    hint: "Higher pitch, brighter tone",
    config: {
      enabled: true,
      pitch: 5,
      drive: 0,
      ring: { hz: 0, mix: 0 },
      vibrato: { hz: 0, depth: 0 },
      tone: { highpass: 150, lowpass: 0 },
      mix: 1,
      gain: 1,
    },
  },
  male: {
    label: "Male",
    hint: "Deeper pitch, warmer tone",
    config: {
      enabled: true,
      pitch: -5,
      drive: 0,
      ring: { hz: 0, mix: 0 },
      vibrato: { hz: 0, depth: 0 },
      tone: { highpass: 0, lowpass: 7000 },
      mix: 1,
      gain: 1.05,
    },
  },
  robot: {
    label: "Robot",
    hint: "Ring-modulated metallic monotone",
    config: {
      enabled: true,
      pitch: 0,
      drive: 0.25,
      ring: { hz: 55, mix: 0.85 },
      vibrato: { hz: 0, depth: 0 },
      tone: { highpass: 0, lowpass: 5000 },
      mix: 1,
      gain: 1,
    },
  },
  alien: {
    label: "Alien",
    hint: "High pitch, ring mod and a shimmering wobble",
    config: {
      enabled: true,
      pitch: 7,
      drive: 0,
      ring: { hz: 180, mix: 0.5 },
      vibrato: { hz: 6, depth: 0.6 },
      tone: { highpass: 200, lowpass: 0 },
      mix: 1,
      gain: 1,
    },
  },
  villain: {
    label: "Villain",
    hint: "Heavy bass, distorted, menacing",
    config: {
      enabled: true,
      pitch: -9,
      drive: 0.5,
      ring: { hz: 30, mix: 0.25 },
      vibrato: { hz: 0, depth: 0 },
      tone: { highpass: 0, lowpass: 4500 },
      mix: 1,
      gain: 1.1,
    },
  },
};

export const presetNames = Object.keys(presets) as VoicePresetName[];
