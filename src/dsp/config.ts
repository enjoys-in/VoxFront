// Shared DSP configuration shape mirrored by the wasm setter ABI.

export interface DspConfig {
  aec: { on: boolean; mu: number };
  ns: { on: boolean; strength: number };
  agc: { on: boolean; target: number };
  comp: { on: boolean; threshold: number; ratio: number; makeup: number };
  vad: { on: boolean; sensitivity: number; gate: boolean };
  fx: { hp: boolean; echo: boolean; delay: number; fb: number; mix: number };
}

export type DspConfigPatch = {
  [K in keyof DspConfig]?: Partial<DspConfig[K]>;
};

export const defaultConfig: DspConfig = {
  aec: { on: false, mu: 0.3 },
  ns: { on: true, strength: 1.0 },
  agc: { on: true, target: 0.12 },
  comp: { on: false, threshold: 0.3, ratio: 3.0, makeup: 1.2 },
  vad: { on: true, sensitivity: 0.5, gate: false },
  fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
};

// DTMF key index (0..15) -> character, matching the wasm row*4 + col layout.
export const DTMF_KEYS = [
  "1", "2", "3", "A",
  "4", "5", "6", "B",
  "7", "8", "9", "C",
  "*", "0", "#", "D",
] as const;

export interface DspStatus {
  vad: boolean;
  rms: number;
  noiseFloor: number;
  gain: number;
}

/** Which signal the local monitor plays, for A/B comparison. */
export type ListenMode = "off" | "processed" | "raw";

export interface Preset {
  label: string;
  hint: string;
  config: DspConfig;
}

export const presets: Record<string, Preset> = {
  clean: {
    label: "Clean voice",
    hint: "Everything on — balanced agent input",
    config: {
      aec: { on: true, mu: 0.3 },
      ns: { on: true, strength: 1.0 },
      agc: { on: true, target: 0.12 },
      comp: { on: true, threshold: 0.3, ratio: 3.0, makeup: 1.2 },
      vad: { on: true, sensitivity: 0.5, gate: false },
      fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
    },
  },
  aggressive: {
    label: "Aggressive denoise",
    hint: "Heavy noise suppression for loud rooms",
    config: {
      aec: { on: true, mu: 0.3 },
      ns: { on: true, strength: 2.0 },
      agc: { on: true, target: 0.14 },
      comp: { on: true, threshold: 0.25, ratio: 4.0, makeup: 1.3 },
      vad: { on: true, sensitivity: 0.7, gate: true },
      fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
    },
  },
  telephone: {
    label: "Telephone",
    hint: "Band-limited, compressed, classic call sound",
    config: {
      aec: { on: true, mu: 0.3 },
      ns: { on: true, strength: 1.2 },
      agc: { on: true, target: 0.16 },
      comp: { on: true, threshold: 0.2, ratio: 6.0, makeup: 1.4 },
      vad: { on: true, sensitivity: 0.5, gate: false },
      fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
    },
  },
  raw: {
    label: "Raw (all off)",
    hint: "No processing — reference for A/B",
    config: {
      aec: { on: false, mu: 0.3 },
      ns: { on: false, strength: 1.0 },
      agc: { on: false, target: 0.12 },
      comp: { on: false, threshold: 0.3, ratio: 3.0, makeup: 1.2 },
      vad: { on: true, sensitivity: 0.5, gate: false },
      fx: { hp: false, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
    },
  },
};
