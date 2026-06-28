"use client";

// React hook that owns a VoiceDSP instance for a component's lifetime and
// surfaces live status. Works in Next.js (app/pages router), Vite, CRA, etc.

import { useEffect, useRef, useState } from "react";
import { VoiceDSP } from "./VoiceDSP";
import type { DspStatus, VoiceDSPOptions } from "./VoiceDSP";

export interface UseVoiceDSP {
  /** The stable VoiceDSP instance (same across re-renders). */
  dsp: VoiceDSP;
  /** Latest status frame (VAD, levels, AGC gain), or null before it starts. */
  status: DspStatus | null;
  /** True once the WASM worklet has signalled "ready". */
  ready: boolean;
}

/**
 * Create and own a VoiceDSP for this component.
 *
 *   const { dsp, status } = useVoiceDSP();
 *   // later, from a user gesture:
 *   const processed = await dsp.start(micStream);
 *
 * The instance is created once and destroyed on unmount.
 */
export function useVoiceDSP(options?: VoiceDSPOptions): UseVoiceDSP {
  const ref = useRef<VoiceDSP | null>(null);
  if (ref.current === null) ref.current = new VoiceDSP(options);
  const dsp = ref.current;

  const [status, setStatus] = useState<DspStatus | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const offStatus = dsp.on("status", setStatus);
    const offReady = dsp.on("ready", () => setReady(true));
    return () => {
      offStatus();
      offReady();
      void dsp.destroy();
    };
    // dsp is stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { dsp, status, ready };
}
