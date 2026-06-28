// Framework-agnostic voice-changer engine.
//
// Wraps the Rust->WASM voice-changer core + its AudioWorklet so you can splice
// it between a microphone and any audio sink (an <audio> element, a WebRTC /
// SIP.js sender track, a MediaRecorder, ...).
//
//   const vc = new VoiceChanger();
//   const out = await vc.start(micStream);   // processed MediaStream
//   vc.setPreset("robot");
//   vc.setConfig({ pitch: -3 });             // live tweak while talking

import { defaultConfig, presets } from "./presets";
import type {
  VoiceChangerConfig,
  VoiceChangerPatch,
  VoiceChangerStatus,
  VoicePresetName,
} from "./types";

export interface VoiceChangerOptions {
  /** URL of the compiled `voice_changer.wasm`. Default `/voice_changer.wasm`. */
  wasmUrl?: string;
  /** URL of the worklet. Default `/worklet/voice-changer-processor.js`. */
  workletUrl?: string;
  /** Initial configuration (merged over {@link defaultConfig}). */
  config?: VoiceChangerPatch;
  /** Initial preset (applied after `config`). */
  preset?: VoicePresetName;
}

type Events = {
  ready: () => void;
  status: (s: VoiceChangerStatus) => void;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Merge a partial patch over a full config (one level of nesting). */
export function mergeConfig(
  base: VoiceChangerConfig,
  patch: VoiceChangerPatch,
): VoiceChangerConfig {
  const out: VoiceChangerConfig = structuredClone(base);
  for (const key of Object.keys(patch) as (keyof VoiceChangerPatch)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    if (isObject(value)) {
      Object.assign(out[key as "ring" | "vibrato" | "tone"], value);
    } else {
      // Primitive field (enabled / pitch / drive / mix / gain).
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export class VoiceChanger {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private config: VoiceChangerConfig;
  private preset: VoicePresetName | null = null;
  private readonly wasmUrl: string;
  private readonly workletUrl: string;
  private listeners: { [K in keyof Events]: Set<Events[K]> } = {
    ready: new Set(),
    status: new Set(),
  };

  constructor(opts: VoiceChangerOptions = {}) {
    this.wasmUrl = opts.wasmUrl ?? "/voice_changer.wasm";
    this.workletUrl = opts.workletUrl ?? "/worklet/voice-changer-processor.js";
    let cfg = opts.config
      ? mergeConfig(defaultConfig, opts.config)
      : structuredClone(defaultConfig);
    if (opts.preset) {
      cfg = structuredClone(presets[opts.preset].config);
      this.preset = opts.preset;
    }
    this.config = cfg;
  }

  get isRunning(): boolean {
    return this.node !== null;
  }

  /** The processed audio. Attach to an <audio>, RTCPeerConnection or recorder. */
  get outputStream(): MediaStream | null {
    return this.dest?.stream ?? null;
  }

  get processedTrack(): MediaStreamTrack | null {
    return this.dest?.stream.getAudioTracks()[0] ?? null;
  }

  /** Start processing `micStream`; resolves to the processed MediaStream. */
  async start(micStream: MediaStream): Promise<MediaStream> {
    if (this.node) return this.dest!.stream;

    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    await ctx.audioWorklet.addModule(this.workletUrl);
    const wasmBytes = await (await fetch(this.wasmUrl)).arrayBuffer();

    const node = new AudioWorkletNode(ctx, "voice-changer-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    this.node = node;
    node.port.onmessage = (e) => this.onMessage(e.data);
    node.port.postMessage(
      { type: "init", wasm: wasmBytes, config: this.config },
      [wasmBytes],
    );

    this.micSource = ctx.createMediaStreamSource(micStream);
    this.micSource.connect(node, 0, 0);

    this.dest = ctx.createMediaStreamDestination();
    node.connect(this.dest);

    return this.dest.stream;
  }

  /** Live partial config update (always sends the full merged config). */
  setConfig(patch: VoiceChangerPatch): void {
    this.config = mergeConfig(this.config, patch);
    this.preset = null; // a manual tweak no longer matches a named preset
    this.node?.port.postMessage({ type: "config", config: this.config });
  }

  /** Replace the whole config. */
  setConfigFull(config: VoiceChangerConfig): void {
    this.config = structuredClone(config);
    this.node?.port.postMessage({ type: "config", config: this.config });
  }

  /** Apply a named preset (female / male / robot / alien / villain / clean). */
  setPreset(name: VoicePresetName): void {
    this.preset = name;
    this.setConfigFull(presets[name].config);
  }

  getPreset(): VoicePresetName | null {
    return this.preset;
  }

  getConfig(): VoiceChangerConfig {
    return structuredClone(this.config);
  }

  /** Master enable/disable (microphone passes through untouched when off). */
  setEnabled(on: boolean): void {
    this.setConfig({ enabled: on });
  }

  /**
   * Swap an outgoing WebRTC/SIP sender's track for the processed one:
   *   const pc = session.sessionDescriptionHandler.peerConnection;
   *   await vc.replaceSenderTrack(pc);
   */
  async replaceSenderTrack(pc: RTCPeerConnection): Promise<boolean> {
    const track = this.processedTrack;
    if (!track) return false;
    const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
    if (!sender) return false;
    await sender.replaceTrack(track);
    return true;
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.listeners[event].add(cb);
    return () => {
      this.listeners[event].delete(cb);
    };
  }

  async destroy(): Promise<void> {
    this.node?.disconnect();
    this.micSource?.disconnect();
    this.dest?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.node = null;
    this.micSource = null;
    this.dest = null;
    this.ctx = null;
  }

  private onMessage(m: { type: string; [k: string]: unknown }): void {
    if (m.type === "ready") {
      this.listeners.ready.forEach((cb) => cb());
    } else if (m.type === "status") {
      const s: VoiceChangerStatus = { rms: m.rms as number };
      this.listeners.status.forEach((cb) => cb(s));
    }
  }
}
