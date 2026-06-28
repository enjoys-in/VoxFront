// Drop-in DSP core for any React (or vanilla) project.
//
// Framework-agnostic. Wraps the Rust→WASM DSP + AudioWorklet so you can splice
// it between the microphone and an RTCPeerConnection's outgoing track (SIP.js,
// LiveKit, plain WebRTC) or just monitor/record locally.
//
// Files this package needs in your app:
//   src/voice-dsp/VoiceDSP.ts             (this file)
//   src/voice-dsp/useVoiceDSP.ts          (React hook)
//   src/voice-dsp/VoiceSettingsButton.tsx (floating settings UI)
//   src/voice-dsp/index.ts                (barrel export)
//   public/voip_dsp.wasm                  (copied build artifact)
//   public/worklet/dsp-processor.js       (copied worklet)
//
// Usage:
//   const dsp = new VoiceDSP();
//   const processed = await dsp.start(micStream);   // processed MediaStream
//   await dsp.replaceSenderTrack(peerConnection);    // swap the call's mic track
//   dsp.setReferenceStream(remoteStream);            // far-end for echo cancel
//   dsp.setConfig({ ns: { strength: 1.5 } });        // live, while talking

export interface DspConfig {
  aec: { on: boolean; mu: number };
  ns: { on: boolean; strength: number };
  agc: { on: boolean; target: number };
  comp: { on: boolean; threshold: number; ratio: number; makeup: number };
  vad: { on: boolean; sensitivity: number; gate: boolean };
  fx: { hp: boolean; echo: boolean; delay: number; fb: number; mix: number };
}

export type DspConfigPatch = { [K in keyof DspConfig]?: Partial<DspConfig[K]> };

export interface DspStatus {
  vad: boolean;
  rms: number;
  noiseFloor: number;
  gain: number;
}

export const defaultConfig: DspConfig = {
  aec: { on: true, mu: 0.3 }, // on by default — useful on real calls
  ns: { on: true, strength: 1.0 },
  agc: { on: true, target: 0.12 },
  comp: { on: false, threshold: 0.3, ratio: 3.0, makeup: 1.2 },
  vad: { on: true, sensitivity: 0.5, gate: false },
  fx: { hp: true, echo: false, delay: 9600, fb: 0.3, mix: 0.4 },
};

export const DTMF_KEYS = [
  "1", "2", "3", "A",
  "4", "5", "6", "B",
  "7", "8", "9", "C",
  "*", "0", "#", "D",
] as const;

export interface VoiceDSPOptions {
  wasmUrl?: string;
  workletUrl?: string;
  config?: DspConfigPatch;
}

type Events = {
  ready: () => void;
  status: (s: DspStatus) => void;
  dtmf: (key: number, char: string) => void;
};

function merge(base: DspConfig, patch: DspConfigPatch): DspConfig {
  const out: DspConfig = structuredClone(base);
  for (const k of Object.keys(patch) as (keyof DspConfig)[]) {
    Object.assign(out[k], patch[k]);
  }
  return out;
}

export class VoiceDSP {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private refSource: MediaStreamAudioSourceNode | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private config: DspConfig;
  private bypass = false;
  private readonly wasmUrl: string;
  private readonly workletUrl: string;
  private listeners: { [K in keyof Events]: Set<Events[K]> } = {
    ready: new Set(),
    status: new Set(),
    dtmf: new Set(),
  };

  constructor(opts: VoiceDSPOptions = {}) {
    this.wasmUrl = opts.wasmUrl ?? "/voip_dsp.wasm";
    this.workletUrl = opts.workletUrl ?? "/worklet/dsp-processor.js";
    this.config = opts.config ? merge(defaultConfig, opts.config) : structuredClone(defaultConfig);
  }

  get isRunning(): boolean {
    return this.node !== null;
  }

  /** The cleaned audio. Attach to an RTCPeerConnection sender (or an <audio>). */
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

    const node = new AudioWorkletNode(ctx, "dsp-processor", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    this.node = node;
    node.port.onmessage = (e) => this.onMessage(e.data);
    node.port.postMessage({ type: "init", wasm: wasmBytes, config: this.config }, [wasmBytes]);
    node.port.postMessage({ type: "bypass", on: this.bypass });

    this.micSource = ctx.createMediaStreamSource(micStream);
    this.micSource.connect(node, 0, 0);

    this.dest = ctx.createMediaStreamDestination();
    node.connect(this.dest);

    return this.dest.stream;
  }

  /**
   * Feed the remote party's audio as the echo-cancellation reference. Pass the
   * `MediaStream` you're playing through the <audio> element for the call.
   */
  setReferenceStream(remote: MediaStream | null): void {
    if (!this.ctx || !this.node) return;
    this.refSource?.disconnect();
    this.refSource = null;
    if (remote && remote.getAudioTracks().length > 0) {
      this.refSource = this.ctx.createMediaStreamSource(remote);
      this.refSource.connect(this.node, 0, 1); // worklet input 1 = AEC reference
    }
  }

  /**
   * Swap the call's outgoing microphone track for the processed one. Call this
   * once the SIP.js session is "Established":
   *   const pc = session.sessionDescriptionHandler.peerConnection;
   *   await dsp.replaceSenderTrack(pc);
   */
  async replaceSenderTrack(pc: RTCPeerConnection): Promise<boolean> {
    const track = this.processedTrack;
    if (!track) return false;
    const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
    if (!sender) return false;
    await sender.replaceTrack(track);
    return true;
  }

  /** Live partial config update (always sends the full merged config). */
  setConfig(patch: DspConfigPatch): void {
    this.config = merge(this.config, patch);
    this.node?.port.postMessage({ type: "config", config: this.config });
  }

  setConfigFull(config: DspConfig): void {
    this.config = structuredClone(config);
    this.node?.port.postMessage({ type: "config", config: this.config });
  }

  getConfig(): DspConfig {
    return structuredClone(this.config);
  }

  /** Master bypass: emit the raw mic untouched (A/B the whole chain). */
  setBypass(on: boolean): void {
    this.bypass = on;
    this.node?.port.postMessage({ type: "bypass", on });
  }

  getBypass(): boolean {
    return this.bypass;
  }

  on<K extends keyof Events>(event: K, cb: Events[K]): () => void {
    this.listeners[event].add(cb);
    return () => this.listeners[event].delete(cb);
  }

  async destroy(): Promise<void> {
    this.node?.disconnect();
    this.micSource?.disconnect();
    this.refSource?.disconnect();
    this.dest?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.node = null;
    this.micSource = null;
    this.refSource = null;
    this.dest = null;
    this.ctx = null;
  }

  private onMessage(m: { type: string; [k: string]: unknown }): void {
    if (m.type === "ready") {
      this.listeners.ready.forEach((cb) => cb());
    } else if (m.type === "status") {
      const s: DspStatus = {
        vad: m.vad as boolean,
        rms: m.rms as number,
        noiseFloor: m.noiseFloor as number,
        gain: m.gain as number,
      };
      this.listeners.status.forEach((cb) => cb(s));
    } else if (m.type === "dtmf") {
      const key = m.key as number;
      this.listeners.dtmf.forEach((cb) => cb(key, DTMF_KEYS[key] ?? "?"));
    }
  }
}
