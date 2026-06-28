# Voice DSP — React integration guide

Local, low-latency audio preprocessing (echo cancellation, noise suppression,
auto-gain, VAD, DTMF, effects) that runs in the browser as **Rust → WebAssembly
inside an AudioWorklet**. Drop it into any React app and give users a **floating
settings button** to tune it live while they speak.

No runtime npm dependencies (besides React). It's plain Web Audio + WASM.

---

## 1. Directory structure

Copy the `voice-dsp/` folder into your app's source, and the two build
artifacts into `public/`:

```
your-react-app/
├─ public/
│  ├─ voip_dsp.wasm                 ← build artifact (copy as-is)
│  └─ worklet/
│     └─ dsp-processor.js           ← AudioWorklet (copy as-is)
└─ src/
   └─ voice-dsp/
      ├─ index.ts                   ← barrel export (import from here)
      ├─ VoiceDSP.ts                ← framework-agnostic core
      ├─ useVoiceDSP.ts             ← React hook
      └─ VoiceSettingsButton.tsx    ← floating gear + settings panel
```

> Vite/CRA: `public/` is the web root, so the files resolve at `/voip_dsp.wasm`
> and `/worklet/dsp-processor.js`. Next.js: same — `public/` maps to `/`.

---

## 2. Install

1. **Copy the artifacts** from this repo to your app:
   - `public/voip_dsp.wasm` → `your-app/public/voip_dsp.wasm`
   - `public/worklet/dsp-processor.js` → `your-app/public/worklet/dsp-processor.js`
2. **Copy the source** `embed/voice-dsp/` → `your-app/src/voice-dsp/`.
3. That's it — no `npm install` needed.

If the URLs differ in your app, pass them when constructing:

```ts
new VoiceDSP({ wasmUrl: "/assets/voip_dsp.wasm", workletUrl: "/assets/dsp-processor.js" });
```

---

## 3. Imports cheat-sheet

```ts
import {
  VoiceDSP,              // core class
  useVoiceDSP,           // React hook (recommended)
  VoiceSettingsButton,   // floating settings UI
  attachDsp,             // one-call WebRTC wiring helper
  defaultConfig,
  DTMF_KEYS,
} from "@/voice-dsp";    // or "../voice-dsp" — wherever you put the folder

import type { DspConfig, DspStatus, VoiceDSPOptions } from "@/voice-dsp";
```

---

## 4. Quick start (any React app)

Capture the mic, process it, render the floating settings button, and (here)
monitor it locally. `start()` must be called from a **user gesture** (it creates
an `AudioContext`).

```tsx
"use client"; // Next.js app router only

import { useVoiceDSP, VoiceSettingsButton } from "@/voice-dsp";

export default function MicDemo() {
  const { dsp, status } = useVoiceDSP();

  async function startMic() {
    // raw mic — disable the browser's own EC/NS so our DSP owns it
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const processed = await dsp.start(mic);

    // example: listen to the cleaned audio (use headphones!)
    const el = new Audio();
    el.srcObject = processed;
    el.play();
  }

  return (
    <div>
      <button onClick={startMic}>Start mic</button>
      <p>VAD: {status?.vad ? "speech" : "silent"} · level {status?.rms.toFixed(3) ?? "—"}</p>

      {/* the floating gear — user tweaks DSP live */}
      <VoiceSettingsButton dsp={dsp} />
    </div>
  );
}
```

---

## 5. Use in a WebRTC / SIP.js call

Insert the DSP between the mic and the outgoing RTP track. Once your call is
**connected/established**, grab the `RTCPeerConnection` and call `attachDsp`:

```tsx
"use client";

import { useVoiceDSP, VoiceSettingsButton, attachDsp } from "@/voice-dsp";

export function CallScreen({ session }: { session: any /* SIP.js Session */ }) {
  const { dsp, status } = useVoiceDSP();

  // call this when the session reaches "Established"
  async function onEstablished() {
    const pc: RTCPeerConnection = session.sessionDescriptionHandler.peerConnection;
    await attachDsp(pc, dsp); // routes mic → DSP → sender, wires AEC reference
  }

  return (
    <>
      {/* ...your call UI... */}
      <VoiceSettingsButton dsp={dsp} accent="#4cc2ff" position="bottom-right" />
    </>
  );
}
```

**Tip (SIP.js):** when creating the Inviter / accepting the Invitation, disable
the browser's built-in processing so the WASM DSP is the only one running:

```ts
const options = {
  sessionDescriptionHandlerOptions: {
    constraints: {
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    },
  },
};
```

Plain WebRTC, LiveKit, etc. work the same way — anything that exposes an
`RTCPeerConnection` can use `attachDsp(pc, dsp)`.

---

## 6. `<VoiceSettingsButton />` props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `dsp` | `VoiceDSP` | — | **Required.** The instance from `useVoiceDSP()`. |
| `accent` | `string` | `"#4cc2ff"` | Accent color (FAB + controls). |
| `position` | `"bottom-right" \| "bottom-left"` | `"bottom-right"` | Floating corner. |

The panel exposes: master **Preprocessing** on/off (A/B bypass), **Noise
suppression** (+ strength), **Echo cancellation**, **Auto gain** (+ target),
**VAD gate**, quick **presets**, and a live VAD/level meter. Every change is
applied instantly via `postMessage` to the audio thread — no call interruption.

The component is **self-contained (inline styles)** so it won't inherit or fight
your Tailwind/shadcn theme.

---

## 7. Programmatic control (`VoiceDSP`)

```ts
const dsp = new VoiceDSP();
const processed = await dsp.start(micStream); // MediaStream

dsp.setConfig({ ns: { strength: 1.5 }, agc: { on: true } }); // live, partial
dsp.setBypass(true);                                          // raw passthrough (A/B)
dsp.setReferenceStream(remoteStream);                         // AEC far-end ref
await dsp.replaceSenderTrack(peerConnection);                 // swap call track

const off = dsp.on("status", (s) => console.log(s.vad, s.rms, s.gain));
dsp.on("dtmf", (key, char) => console.log("DTMF", char)); // touch-tone detected

await dsp.destroy(); // tears down AudioContext + nodes
```

### Config reference (`DspConfig`)

| Group | Field | Meaning |
| --- | --- | --- |
| `aec` | `on`, `mu` | Echo cancellation + adaptation step (needs `setReferenceStream`) |
| `ns` | `on`, `strength` | Noise suppression (0–2, higher = stronger) |
| `agc` | `on`, `target` | Auto gain → target RMS |
| `comp` | `on`, `threshold`, `ratio`, `makeup` | Dynamic-range compressor |
| `vad` | `on`, `sensitivity`, `gate` | Voice activity; `gate` mutes non-speech |
| `fx` | `hp`, `echo`, `delay`, `fb`, `mix` | Rumble high-pass + echo effect |

`import { defaultConfig } from "@/voice-dsp"` for the starting values.

---

## 8. Framework notes

- **Next.js (app router):** any file using the hook/component needs `"use client"`
  at the top (already present in the package files). Keep `public/voip_dsp.wasm`
  and `public/worklet/dsp-processor.js` exactly there.
- **Vite / CRA:** no config needed; artifacts in `public/` are served at root.
- **TypeScript:** the package is strict-mode clean. It uses DOM + WebAudio types
  only (no extra `@types`).

---

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `AudioContext was not allowed to start` | Call `dsp.start()` from a click/tap, not on mount. |
| 404 for `voip_dsp.wasm` / `dsp-processor.js` | Check they're in `public/` and the URLs match (or pass `wasmUrl`/`workletUrl`). |
| No echo cancellation | You must pass the remote audio via `setReferenceStream` / `attachDsp`. |
| Hearing yourself doubled | That's the local monitor — only play `processed` for testing, with headphones. |
| Feature toggle "does nothing" | Ensure you're on the latest `VoiceDSP.ts` (it always sends the full config). |
| Robotic/musical noise | Lower `ns.strength` (try 0.8–1.2). |
