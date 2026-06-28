// Public entry point for the voice-changer package.
//
// Framework-agnostic core:
//   import { VoiceChanger, presets } from "@enjoys/voice-changer";
//
// React hook (separate subpath to keep React out of the core):
//   import { useVoiceChanger } from "@enjoys/voice-changer/react";

export { VoiceChanger, mergeConfig } from "./engine";
export type { VoiceChangerOptions } from "./engine";
export { defaultConfig, presets, presetNames } from "./presets";
export type { VoicePreset } from "./presets";
export type {
  VoiceChangerConfig,
  VoiceChangerPatch,
  VoiceChangerStatus,
  VoicePresetName,
} from "./types";
