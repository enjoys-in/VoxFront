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
import { VoiceChanger, mergeConfig } from "./engine";
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
  // Same precedence as the engine constructor: a preset replaces `config`.
  const [config, setConfigState] = useState<VoiceChangerConfig>(() =>
    options.preset
      ? structuredClone(presets[options.preset].config)
      : mergeConfig(defaultConfig, options.config ?? {}),
  );
  const [preset, setPresetState] = useState<VoicePresetName | null>(
    options.preset ?? null,
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [level, setLevel] = useState(0);

  const mediaRef = useRef<MediaStream | null>(null);
  const startingRef = useRef<Promise<MediaStream | null> | null>(null);
  // Mirrors of config/preset readable synchronously (e.g. setPreset then start
  // in the same click handler) so start() uses the user's latest choice.
  const configRef = useRef(config);
  const presetRef = useRef(preset);

  const commit = useCallback(
    (next: VoiceChangerConfig, name: VoicePresetName | null): void => {
      configRef.current = next;
      presetRef.current = name;
      setConfigState(next);
      setPresetState(name);
    },
    [],
  );

  const run = useCallback(async (external?: MediaStream): Promise<MediaStream | null> => {
    setError(null);
    const o = optsRef.current;
    const engine = new VoiceChanger({
      wasmUrl: o.wasmUrl,
      workletUrl: o.workletUrl,
      config: configRef.current,
      preset: presetRef.current ?? undefined,
    });
    engineRef.current = engine;
    engine.on("ready", () => setReady(true));
    engine.on("status", (s) => setLevel(Math.min(1, s.rms * 2.8)));

    let mic: MediaStream | null = external ?? null;
    try {
      mic ??= await navigator.mediaDevices.getUserMedia({
        audio: o.audioConstraints ?? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
        video: false,
      });
      if (!external) mediaRef.current = mic;

      const out = await engine.start(mic);
      if (engineRef.current !== engine) throw new Error("Stopped while starting");
      setStream(out);
      setRunning(true);
      return out;
    } catch (err) {
      await engine.destroy();
      // Release a microphone we opened ourselves; never stop a caller's stream.
      if (!external) mic?.getTracks().forEach((t) => t.stop());
      if (mediaRef.current === mic) mediaRef.current = null;
      if (engineRef.current === engine) {
        engineRef.current = null;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
      return null;
    }
  }, []);

  const start = useCallback(
    (external?: MediaStream): Promise<MediaStream | null> => {
      if (engineRef.current?.isRunning) {
        return Promise.resolve(engineRef.current.outputStream);
      }
      // A second call while starting (e.g. double click) joins the first.
      startingRef.current ??= run(external).finally(() => {
        startingRef.current = null;
      });
      return startingRef.current;
    },
    [run],
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

  const setConfig = useCallback(
    (patch: VoiceChangerPatch): void => {
      engineRef.current?.setConfig(patch);
      commit(mergeConfig(configRef.current, patch), null);
    },
    [commit],
  );

  const setPreset = useCallback(
    (name: VoicePresetName): void => {
      engineRef.current?.setPreset(name);
      commit(structuredClone(presets[name].config), name);
    },
    [commit],
  );

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
