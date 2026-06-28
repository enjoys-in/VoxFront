// AudioWorklet processor that hosts the voice-changer WASM core.
//
// Runs in the AudioWorkletGlobalScope: no `fetch`, no DOM, no modules. The main
// thread fetches the compiled wasm bytes and posts them here; we instantiate
// synchronously and process each 128-sample render quantum on the audio thread.
//
// Ports:
//   input 0  -> microphone (mono)
//   output 0 -> processed (voice-changed) audio

class VoiceChangerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false;
    this.exports = null;
    this.frame = 128;
    this.statusEvery = 8; // post a level meter roughly every ~21 ms
    this.tick = 0;
    this.pendingConfig = null;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === "init") {
        this.init(msg.wasm, msg.config);
      } else if (msg.type === "config") {
        if (this.ready) this.applyConfig(msg.config);
        else this.pendingConfig = msg.config;
      }
    };
  }

  init(wasmBytes, config) {
    const module = new WebAssembly.Module(wasmBytes);
    const instance = new WebAssembly.Instance(module, {});
    this.exports = instance.exports;
    this.exports.vc_init(sampleRate); // `sampleRate` is a worklet global
    this.frame = this.exports.vc_frame_size();
    this.inPtr = this.exports.vc_input_ptr();
    this.outPtr = this.exports.vc_output_ptr();
    this.ready = true;
    if (config) this.applyConfig(config);
    if (this.pendingConfig) {
      this.applyConfig(this.pendingConfig);
      this.pendingConfig = null;
    }
    this.port.postMessage({ type: "ready", sampleRate, frame: this.frame });
  }

  applyConfig(c) {
    const e = this.exports;
    const b = (v) => (v ? 1 : 0);
    e.vc_set_enabled(b(c.enabled));
    e.vc_set_pitch(c.pitch);
    e.vc_set_drive(c.drive);
    e.vc_set_ring(c.ring.hz, c.ring.mix);
    e.vc_set_vibrato(c.vibrato.hz, c.vibrato.depth);
    e.vc_set_tone(c.tone.highpass, c.tone.lowpass);
    e.vc_set_mix(c.mix);
    e.vc_set_gain(c.gain);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!this.ready || output.length === 0) return true;

    const mic = inputs[0];
    const N = this.frame;
    const buf = this.exports.memory.buffer;

    // Microphone -> wasm input buffer.
    const inView = new Float32Array(buf, this.inPtr, N);
    if (mic && mic.length > 0 && mic[0].length === N) {
      inView.set(mic[0]);
    } else {
      inView.fill(0);
    }

    this.exports.vc_process();

    // wasm output -> all output channels.
    const outView = new Float32Array(buf, this.outPtr, N);
    for (let ch = 0; ch < output.length; ch++) {
      output[ch].set(outView);
    }

    if (++this.tick >= this.statusEvery) {
      this.tick = 0;
      this.port.postMessage({ type: "status", rms: this.exports.vc_get_rms() });
    }

    return true;
  }
}

registerProcessor("voice-changer-processor", VoiceChangerProcessor);
