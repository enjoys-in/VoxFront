// Public configuration shape for the voice changer, mirrored by the wasm
// setter ABI (`vc_set_*`).

export interface VoiceChangerConfig {
  /** Master enable. When false the microphone passes through untouched. */
  enabled: boolean;
  /** Pitch shift in semitones (-24..24). Negative = deeper, positive = higher. */
  pitch: number;
  /** Waveshaper drive 0..1 (adds harmonic grit / distortion). */
  drive: number;
  /** Ring modulator — metallic "robot/alien" timbre. */
  ring: { hz: number; mix: number };
  /** Vibrato — periodic pitch wobble. `depth` is in semitones. */
  vibrato: { hz: number; depth: number };
  /** Tone shaping. A cutoff of 0 disables that filter. */
  tone: { highpass: number; lowpass: number };
  /** Dry/wet blend 0..1 (1 = fully processed). */
  mix: number;
  /** Output gain (linear, 0..4). */
  gain: number;
}

/** Partial update — nested groups can be patched independently. */
export interface VoiceChangerPatch {
  enabled?: boolean;
  pitch?: number;
  drive?: number;
  ring?: Partial<VoiceChangerConfig["ring"]>;
  vibrato?: Partial<VoiceChangerConfig["vibrato"]>;
  tone?: Partial<VoiceChangerConfig["tone"]>;
  mix?: number;
  gain?: number;
}

/** Live status pushed from the audio thread. */
export interface VoiceChangerStatus {
  /** Output RMS level (0..1-ish), handy for a meter. */
  rms: number;
}

/** Built-in preset identifiers. */
export type VoicePresetName =
  | "clean"
  | "female"
  | "male"
  | "robot"
  | "alien"
  | "villain";
