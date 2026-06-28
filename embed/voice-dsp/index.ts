// Public API for the voice-dsp package.

export { VoiceDSP, defaultConfig, DTMF_KEYS } from "./VoiceDSP";
export type {
  DspConfig,
  DspConfigPatch,
  DspStatus,
  VoiceDSPOptions,
} from "./VoiceDSP";

export { useVoiceDSP } from "./useVoiceDSP";
export type { UseVoiceDSP } from "./useVoiceDSP";

export { VoiceSettingsButton } from "./VoiceSettingsButton";
export type { VoiceSettingsButtonProps } from "./VoiceSettingsButton";

import { VoiceDSP } from "./VoiceDSP";

/**
 * One-call wiring for any WebRTC stack (SIP.js, LiveKit, plain RTCPeerConnection).
 * Routes the call's existing outgoing mic track through the DSP, sends the
 * cleaned track, and (if a remote stream is available) uses it as the
 * echo-cancellation reference. Call once the connection/session is established.
 *
 * @returns the processed MediaStream, or null if no audio sender was found.
 */
export async function attachDsp(
  pc: RTCPeerConnection,
  dsp: VoiceDSP,
  remoteStream?: MediaStream,
): Promise<MediaStream | null> {
  const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
  if (!sender?.track) return null;

  const micStream = new MediaStream([sender.track]);
  const processed = await dsp.start(micStream);
  await dsp.replaceSenderTrack(pc);

  const remote =
    remoteStream ??
    new MediaStream(
      pc
        .getReceivers()
        .map((r) => r.track)
        .filter((t): t is MediaStreamTrack => !!t && t.kind === "audio"),
    );
  if (remote.getAudioTracks().length > 0) dsp.setReferenceStream(remote);

  return processed;
}
