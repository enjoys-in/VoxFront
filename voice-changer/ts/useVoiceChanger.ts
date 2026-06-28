"use client";

// React hook wrapper around the framework-agnostic VoiceChanger engine.
//
//   import { useVoiceChanger } from "@enjoys/voice-changer/react";
//
//   function Mic() {
//     const vc = useVoiceChanger();
//     return (
//       <>
//         <button onClick={() => vc.start()}>Start</button>
//         <button onClick={() => vc.setPreset("robot")}>Robot</button>
//         <input type="range" min={-12} max={12} value={vc.config.pitch}
//                onChange={(e) => vc.setConfig({ pitch: +e.target.value })} />
//         {vc.stream && <audio autoPlay srcObject={vc.stream as any} />}
//       </>
//     );
//   }

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceChanger } from "./engine";
import type { VoiceChangerOptions } from "./engine";
import { defaultConfig, presets } from "./presets";
import type {
  VoiceChangerConfig,
  VoiceChangerPatch,
  VoicePresetName,
} from "./types";

export interface UseVoiceChangerOptions extends VoiceChangerOptions {
  /**
   * `getUserMedia` constraints used when {@link UseVoiceChangerResult.start} is
   * called without an explicit stream. The browser's own EC/NS/AGC are off by
   * default so the changer is the single source of truth.
   */
  audioConstraints?: MediaTrackConstraints;
}

export interface UseVoiceChangerResult {
  /** Start processing. Pass a MediaStream, or omit to request the microphone. */
  start: (stream?: MediaStream) => Promise<MediaStream | null>;
  /** Stop and release the microphone + audio graph. */
  stop: () => Promise<void>;
  /** Worklet has loaded and is processing. */
  ready: boolean;
  /** Engine is started. */
  running: boolean;
  /** Last error from start/getUserMedia, if any. */
  error: Error | null;
  /** Current configuration (reactive). */
  config: VoiceChangerConfig;
  /** Live partial config update. */
  setConfig: (patch: VoiceChangerPatch) => void;
  /** Apply a named preset. */
  setPreset: (name: VoicePresetName) => void;
  /** Active preset name, or null after a manual tweak. */
  preset: VoicePresetName | null;
  /** All built-in presets (for building a picker). */
  presets: typeof presets;
  /** Processed output stream (attach to <audio> / WebRTC sender). */
  stream: MediaStream | null;
  /** Output level 0..1 for a meter. */
  level: number;
  /** The underlying engine, for advanced use (e.g. replaceSenderTrack). */
  engine: VoiceChanger | null;
}

export function useVoiceChanger(
  options: UseVoiceChangerOptions = {},
): UseVoiceChangerResult {
  const optsRef = useRef(options);
  optsRef.current = options;

  const engineRef = useRef<VoiceChanger | null>(null);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [config, setConfigState] = useState<VoiceChangerConfig>(() => {
    if (options.preset) return structuredClone(presets[options.preset].config);
    return structuredClone(defaultConfig);
  });
  const [preset, setPresetState] = useState<VoicePresetName | null>(
    options.preset ?? null,
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);

  const mediaRef = useRef<MediaStream | null>(null);

  const start = useCallback(
    async (external?: MediaStream): Promise<MediaStream | null> => {
      if (engineRef.current?.isRunning) {
        return engineRef.current.outputStream;
      }
      setError(null);
      try {
        const o = optsRef.current;
        const engine = new VoiceChanger({
          wasmUrl: o.wasmUrl,
          workletUrl: o.workletUrl,
          config: o.config,
          preset: o.preset,
        });
        engineRef.current = engine;
        engine.on("ready", () => setReady(true));
        engine.on("status", (s) => setLevel(Math.min(1, s.rms * 2.8)));

        const mic =
          external ??
          (await navigator.mediaDevices.getUserMedia({
            audio: o.audioConstraints ?? {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
              channelCount: 1,
            },
            video: false,
          }));
        if (!external) mediaRef.current = mic;

        const out = await engine.start(mic);
        setStream(out);
        setRunning(true);
        setConfigState(engine.getConfig());
        setPresetState(engine.getPreset());
        return out;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        await engineRef.current?.destroy();
        engineRef.current = null;
        return null;
      }
    },
    [],
  );

  const stop = useCallback(async (): Promise<void> => {
    await engineRef.current?.destroy();
    engineRef.current = null;
    mediaRef.current?.getTracks().forEach((t) => t.stop());
    mediaRef.current = null;
    setStream(null);
    setRunning(false);
    setReady(false);
    setLevel(0);
  }, []);

  const setConfig = useCallback((patch: VoiceChangerPatch): void => {
    const engine = engineRef.current;
    if (engine) {
      engine.setConfig(patch);
      setConfigState(engine.getConfig());
      setPresetState(engine.getPreset());
    } else {
      setConfigState((prev) => {
        const next = structuredClone(prev);
        for (const k of Object.keys(patch) as (keyof VoiceChangerPatch)[]) {
          const v = patch[k];
          if (v === undefined) continue;
          if (typeof v === "object") {
            Object.assign((next as Record<string, unknown>)[k] as object, v);
          } else {
            (next as Record<string, unknown>)[k] = v;
          }
        }
        return next;
      });
      setPresetState(null);
    }
  }, []);

  const setPreset = useCallback((name: VoicePresetName): void => {
    const engine = engineRef.current;
    if (engine) {
      engine.setPreset(name);
      setConfigState(engine.getConfig());
    } else {
      setConfigState(structuredClone(presets[name].config));
    }
    setPresetState(name);
  }, []);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      void stop();
    };
  }, [stop]);

  return {
    start,
    stop,
    ready,
    running,
    error,
    config,
    setConfig,
    setPreset,
    preset,
    presets,
    stream,
    level,
    engine: engineRef.current,
  };
}
