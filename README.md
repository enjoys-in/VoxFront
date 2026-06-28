# Browser VoIP DSP — AI voice agent preprocessing

Local, low-latency audio preprocessing for AI voice agents. Instead of streaming
every raw microphone frame to your server, the audio is cleaned **in the
browser** — inside an `AudioWorklet` running a Rust DSP core compiled to
WebAssembly — and only the processed (and optionally VAD-gated, Opus-compressed)
audio is sent on to your AI / SIP backend.

```
Microphone ─▶ WASM DSP ─┬─ Echo cancellation (custom NLMS)
                        ├─ Noise suppression  (spectral subtraction)
                        ├─ Volume normalize   (AGC)
                        ├─ Voice activity detect
                        ├─ DTMF detect        (Goertzel)
                        └─ Compress / effects ─▶ AI / SIP server
```

## Why client-side DSP

- **Less bandwidth / cost** — gate out silence and send compressed audio.
- **Lower server load** — no per-frame DSP on the backend.
- **Privacy** — noise/echo removed before audio ever leaves the device.
- **Latency** — processing happens on the audio render thread (128-sample
  quanta), not over the network.

## Architecture

| Layer | File | Role |
| --- | --- | --- |
| DSP core (WASM) | [rust-dsp/src/lib.rs](rust-dsp/src/lib.rs) | Orchestration + exported C ABI |
| Echo cancellation | [rust-dsp/src/aec.rs](rust-dsp/src/aec.rs) | NLMS adaptive filter + double-talk guard |
| Noise suppression | [rust-dsp/src/ns.rs](rust-dsp/src/ns.rs) | STFT spectral subtraction (256-pt, 50% overlap) |
| AGC + compressor | [rust-dsp/src/agc.rs](rust-dsp/src/agc.rs) | Volume normalize + dynamic range compression |
| VAD | [rust-dsp/src/vad.rs](rust-dsp/src/vad.rs) | Energy + zero-crossing with adaptive noise floor |
| DTMF | [rust-dsp/src/dtmf.rs](rust-dsp/src/dtmf.rs) | Goertzel touch-tone detection |
| Effects | [rust-dsp/src/effects.rs](rust-dsp/src/effects.rs) | Biquad high-pass + feedback delay |
| FFT | [rust-dsp/src/fft.rs](rust-dsp/src/fft.rs) | Radix-2 complex FFT |
| Audio host | [public/worklet/dsp-processor.js](public/worklet/dsp-processor.js) | Instantiates wasm on the audio thread |
| Engine | [src/audio/AudioEngine.ts](src/audio/AudioEngine.ts) | Mic capture, graph wiring, config/status |
| Transport | [src/transport/SipTransport.ts](src/transport/SipTransport.ts) | Opus encode + WebSocket send (stub) |
| UI | [src/main.ts](src/main.ts) | Controls and live meters |

The wasm module exports a flat C ABI and its linear memory. The main thread
fetches the compiled bytes and transfers them to the worklet, which instantiates
**synchronously** (no `fetch` exists in `AudioWorkletGlobalScope`). Each render
quantum the worklet writes 128 mic samples into the shared input buffer, calls
`dsp_process()`, and reads the processed buffer back — no per-frame JS bridge.

## Prerequisites

- Node.js 18+
- Rust toolchain with the wasm target:

```bash
rustup target add wasm32-unknown-unknown
```

## Run

```bash
npm install
npm run dev      # builds the wasm, then starts Vite on http://localhost:5173
```

Open the page, click **Start microphone**, and grant mic access. Toggle
**Monitor** to hear the processed audio (use headphones to avoid feedback).

Other scripts:

```bash
npm run build:wasm   # rebuild only the Rust -> wasm module
npm run build        # typecheck + production bundle
npm run typecheck    # tsc --noEmit
```

## Using each stage

- **Echo cancellation** — click *Play far-end test tone*: a 440 Hz tone plays
  from the speakers and feeds the AEC reference input. With AEC enabled the tone
  is removed from the processed output even though the mic picks it up. In a real
  call, route the remote party's audio node to the worklet's second input.
- **Noise suppression** — *Strength* controls over-subtraction (musical-noise vs
  aggressiveness trade-off).
- **Volume normalize** — drives output toward the *Target RMS*, holding gain
  during silence so background noise is not amplified.
- **VAD** — the indicator lights on speech; enable *Gate output* to mute
  non-speech frames before they reach the server.
- **DTMF** — detected digits appear in the display and flash on the keypad.
- **Compressor / effects** — dynamic range compression plus a rumble high-pass
  and an optional feedback-delay echo effect.

## Sending to your AI / SIP server

Two paths to the backend (the **Send to AI / SIP server** panel):

1. **Real-time call (recommended):** attach `AudioEngine.processedStream`
   (a `MediaStream`) to an `RTCPeerConnection`. The browser handles Opus + RTP;
   your SIP gateway / WebRTC bridge receives clean, normalized audio.
2. **Stream to an AI backend:** the included `SipTransport` encodes the processed
   stream to Opus with `MediaRecorder` and pushes chunks over a WebSocket. Enter
   a `wss://` URL and click *Start streaming*. With no URL it runs locally and
   just reports packet/byte counts so you can see the compression stage working.

## Signal chain (per 128-sample quantum)

```
input ─▶ AEC ─▶ DTMF detect ─▶ noise suppression ─▶ VAD
      ─▶ AGC ─▶ compressor ─▶ effects ─▶ VAD gate ─▶ output
```

## Notes & limitations

- The AEC filter is 1024 taps (~21 ms at 48 kHz) — fine for short acoustic
  paths; long, reverberant rooms need a longer filter and a partitioned
  frequency-domain implementation.
- Noise suppression is classic spectral subtraction with minimum-statistics
  noise tracking; it is intentionally lightweight, not a neural model.
- The `MediaRecorder` transport produces a WebM/Opus container, which is meant to
  demonstrate the compress + transport stage, not as a drop-in RTP source. Use
  WebRTC for production real-time delivery.
