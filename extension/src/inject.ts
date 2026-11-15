// Runs in the page's MAIN world at document_start, before any site script.
//
// Wraps MediaDevices.getUserMedia: when a page asks for the microphone, the
// real stream is routed through the voice-changer WASM worklet and the page
// receives the processed track instead (video tracks pass through untouched).
// If anything fails, the original stream is returned so the site keeps working.

import { EV_HELLO, EV_SETTINGS, EV_STATUS } from "./shared";
import type { PageStatus, Settings } from "./shared";

const WORKLET = "voice-changer-processor.js";
const WASM = "voice_changer.wasm";

let settings: Settings | null = null;
let base = ""; // chrome-extension://<id>/
let wasmBytes: Promise<ArrayBuffer> | null = null;
let lastError: string | null = null;
const nodes = new Set<AudioWorkletNode>();

const gotSettings = new Promise<void>((resolve) => {
  document.addEventListener(EV_SETTINGS, (e) => {
    const msg = JSON.parse((e as CustomEvent<string>).detail) as { base: string; settings: Settings };
    base = msg.base;
    settings = msg.settings;
    for (const node of nodes) node.port.postMessage({ type: "config", config: effectiveConfig() });
    resolve();
  });
});
document.dispatchEvent(new CustomEvent(EV_HELLO));

/** Turning the extension off mid-call switches running streams to pass-through. */
function effectiveConfig() {
  const s = settings!;
  return s.enabled ? s.config : { ...s.config, enabled: false };
}

function report(): void {
  const status: PageStatus = { active: nodes.size, error: lastError };
  document.dispatchEvent(new CustomEvent(EV_STATUS, { detail: JSON.stringify(status) }));
}

async function changeVoice(raw: MediaStream): Promise<MediaStream> {
  const [rawTrack] = raw.getAudioTracks();
  const ctx = new AudioContext({ latencyHint: "interactive" });
  try {
    await ctx.audioWorklet.addModule(base + WORKLET);
    wasmBytes ??= fetch(base + WASM).then((r) => r.arrayBuffer());
    const wasm = (await wasmBytes).slice(0); // copy: each worklet gets its own

    const node = new AudioWorkletNode(ctx, "voice-changer-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.postMessage({ type: "init", wasm, config: effectiveConfig() }, [wasm]);
    const dest = ctx.createMediaStreamDestination();
    ctx.createMediaStreamSource(new MediaStream([rawTrack])).connect(node).connect(dest);
    const track = dest.stream.getAudioTracks()[0];

    // Look like the real mic to the page (device name, settings, constraints).
    Object.defineProperty(track, "label", { get: () => rawTrack.label });
    track.getSettings = () => rawTrack.getSettings();
    track.getConstraints = () => rawTrack.getConstraints();
    track.getCapabilities = () => rawTrack.getCapabilities();
    track.applyConstraints = (c) => rawTrack.applyConstraints(c);

    // Stopping the processed track must release the real microphone too.
    const stopProcessed = track.stop.bind(track);
    const cleanup = () => {
      if (!nodes.delete(node)) return;
      rawTrack.stop();
      node.disconnect();
      void ctx.close();
      report();
    };
    track.stop = () => {
      stopProcessed();
      cleanup();
    };
    rawTrack.addEventListener("ended", () => track.stop());

    // A context created without a user gesture starts suspended (silent).
    if (ctx.state === "suspended") {
      const resume = () => void ctx.resume();
      for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, resume, { once: true, capture: true });
      resume();
    }

    nodes.add(node);
    lastError = null;
    report();
    return new MediaStream([track, ...raw.getVideoTracks()]);
  } catch (err) {
    void ctx.close();
    throw err;
  }
}

// MediaDevices only exists in secure contexts (https, localhost). On plain
// http pages and some sandboxed frames there is no mic API to wrap.
if (typeof MediaDevices !== "undefined") {
  const proto = MediaDevices.prototype;
  const original = proto.getUserMedia;

  proto.getUserMedia = async function (this: MediaDevices, constraints?: MediaStreamConstraints) {
    const raw = await original.call(this, constraints);
    if (!constraints?.audio || raw.getAudioTracks().length === 0) return raw;
    // Settings normally arrive within a few ms; never block the page for long.
    await Promise.race([gotSettings, new Promise((r) => setTimeout(r, 1000))]);
    if (!settings?.enabled || !base) return raw;
    try {
      return await changeVoice(raw);
    } catch (err) {
      lastError = `Voice changer unavailable on this site: ${err instanceof Error ? err.message : err}`;
      console.warn("[VoxFront]", lastError);
      report();
      return raw;
    }
  };
}
