# @enjoys/voice-changer

Plug-and-play **real-time browser voice changer**. A Rust DSP core compiled to
WebAssembly runs inside an `AudioWorklet`, so the microphone is transformed on
the audio render thread (128-sample quanta) — low latency, no per-frame
round-trips to JS.

Built-in characters span **age & gender** — kids (5/10), teens (18), adults
(25/30/35), old lady / old man, plus female/male variants and the
**robot · alien · villain** effects, with live control over pitch, drive, ring
modulation, vibrato and tone.

```
Microphone ─▶ WASM voice changer ─┬─ pitch shift (+ vibrato)
                                  ├─ ring modulator   (robot / alien)
                                  ├─ waveshaper drive (villain grit)
                                  └─ tone (HP / LP) ─▶ <audio> / WebRTC / recorder
```

> The presets pitch-shift the whole spectrum (pitch and timbre move together —
> the classic "deep / chipmunk" character). This is great for fun/disguise
> effects. True formant-preserving male↔female conversion or sounding like a
> *specific* person (neural voice cloning) is a separate, much larger problem
> and is intentionally out of scope here.

## Install / serve the assets

The package ships the compiled `voice_changer.wasm` and the worklet. They must
be served as **static files** by your app.

1. Build the wasm (needs the Rust wasm target — `rustup target add wasm32-unknown-unknown`):

   ```bash
   npm run build:wasm    # from the voice-changer/ folder
   ```

2. Copy the two assets into your app's public directory:

   ```
   dist/voice_changer.wasm            ->  <public>/voice_changer.wasm
   worklet/voice-changer-processor.js ->  <public>/worklet/voice-changer-processor.js
   ```

   (Inside this repo, `npm run build:vc` already copies them into `public/`.)

   If you serve them from other paths, pass `wasmUrl` / `workletUrl` in options.

## React

```tsx
import { useVoiceChanger } from "@enjoys/voice-changer/react";

export function VoiceChangerDemo() {
  const vc = useVoiceChanger({ preset: "robot" });

  return (
    <div>
      {!vc.running ? (
        <button onClick={() => vc.start()}>Start mic</button>
      ) : (
        <button onClick={() => vc.stop()}>Stop</button>
      )}

      <div>
        {Object.entries(vc.presets).map(([key, p]) => (
          <button
            key={key}
            data-active={vc.preset === key}
            onClick={() => vc.setPreset(key as keyof typeof vc.presets)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <label>
        Pitch {vc.config.pitch}
        <input
          type="range" min={-12} max={12} step={1}
          value={vc.config.pitch}
          onChange={(e) => vc.setConfig({ pitch: Number(e.target.value) })}
        />
      </label>

      {/* play the changed voice back (use headphones to avoid feedback) */}
      {vc.stream && (
        <audio
          autoPlay
          ref={(el) => { if (el) el.srcObject = vc.stream; }}
        />
      )}
    </div>
  );
}
```

The hook returns: `start`, `stop`, `ready`, `running`, `error`, `config`,
`setConfig`, `setPreset`, `preset`, `presets`, `stream`, `level`, `engine`.

## Framework-agnostic (vanilla / Vue / Svelte / SIP.js)

```ts
import { VoiceChanger } from "@enjoys/voice-changer";

const vc = new VoiceChanger({ preset: "villain" });

const mic = await navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
});
const processed = await vc.start(mic);   // a MediaStream

// Play it, or send it to a call:
audioEl.srcObject = processed;
// await vc.replaceSenderTrack(peerConnection);  // swap the outgoing SIP/WebRTC track

vc.setPreset("alien");
vc.setConfig({ pitch: -3, drive: 0.4 });  // live, while talking
vc.setEnabled(false);                     // bypass (raw mic)
await vc.destroy();
```

## Configuration

| Field | Range | Effect |
| --- | --- | --- |
| `enabled` | bool | Master on/off (off = raw mic passthrough) |
| `pitch` | -24..24 st | Pitch shift (− deeper, + higher) |
| `drive` | 0..1 | Waveshaper grit / distortion |
| `ring.hz` / `ring.mix` | Hz / 0..1 | Ring modulator (robot/alien timbre) |
| `vibrato.hz` / `vibrato.depth` | Hz / semitones | Periodic pitch wobble |
| `tone.highpass` / `tone.lowpass` | Hz (0 = off) | One-pole tone shaping |
| `mix` | 0..1 | Dry/wet blend |
| `gain` | 0..4 | Output gain |

## How it works

| Layer | File |
| --- | --- |
| DSP core (WASM) | `src/lib.rs` |
| Pitch shifter | `src/pitch.rs` (two-tap crossfading delay line) |
| Ring mod / drive / tone | `src/fx.rs` |
| Worklet host | `worklet/voice-changer-processor.js` |
| Engine | `ts/engine.ts` |
| Presets | `ts/presets.ts` |
| React hook | `ts/useVoiceChanger.ts` |
