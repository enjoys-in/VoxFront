// Settings + message names shared by the popup, the bridge (isolated world)
// and the injected page script (main world).

import { defaultConfig } from "../../voice-changer/ts/presets";
import type { VoiceChangerConfig, VoicePresetName } from "../../voice-changer/ts/types";

export interface Settings {
  /** Intercept microphone streams at all. */
  enabled: boolean;
  /** Active preset, or null after a manual tweak. */
  preset: VoicePresetName | null;
  /** Full voice-changer config sent to the worklet. */
  config: VoiceChangerConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  preset: null,
  config: defaultConfig,
};

/** Live state of one tab, reported by the page script. */
export interface PageStatus {
  active: number; // processed mic streams currently running
  error: string | null;
}

// DOM events used to talk across the main / isolated world boundary
// (string payloads cross worlds safely).
export const EV_HELLO = "voxfront:hello"; // main -> isolated: send me settings
export const EV_SETTINGS = "voxfront:settings"; // isolated -> main: { base, settings }
export const EV_STATUS = "voxfront:status"; // main -> isolated: PageStatus
