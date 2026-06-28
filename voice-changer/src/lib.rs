//! Voice-changer — WebAssembly DSP core.
//!
//! A single global processor instance works on shared linear-memory buffers.
//! The AudioWorklet host writes one 128-sample quantum into the input buffer,
//! calls [`vc_process`], then reads the processed quantum back from the output
//! buffer.
//!
//! Signal chain per quantum:
//!   input -> pitch shift (+ vibrato) -> ring mod -> drive -> tone -> dry/wet

mod fx;
mod pitch;

use core::f32::consts::PI;
use fx::{waveshape, Ring, Tone};
use libm::{powf, sinf, sqrtf};
use pitch::Pitch;

/// AudioWorklet render quantum.
pub const HOP: usize = 128;

struct Config {
    enabled: bool,
    pitch_st: f32,   // semitones, -24..24
    drive: f32,      // 0..1 waveshaper amount
    ring_hz: f32,    // ring-modulator carrier frequency
    ring_mix: f32,   // 0..1
    vib_hz: f32,     // vibrato rate
    vib_depth: f32,  // vibrato depth in semitones
    hp_hz: f32,      // tone high-pass cutoff (0 = off)
    lp_hz: f32,      // tone low-pass cutoff (0 = off)
    mix: f32,        // 0..1 dry/wet
    gain: f32,       // output gain
}

impl Config {
    const fn new() -> Self {
        Config {
            enabled: true,
            pitch_st: 0.0,
            drive: 0.0,
            ring_hz: 0.0,
            ring_mix: 0.0,
            vib_hz: 0.0,
            vib_depth: 0.0,
            hp_hz: 0.0,
            lp_hz: 0.0,
            mix: 1.0,
            gain: 1.0,
        }
    }
}

struct Vc {
    fs: f32,
    input: [f32; HOP],
    output: [f32; HOP],
    dry: [f32; HOP],
    pitch: Pitch,
    ring: Ring,
    tone: Tone,
    lfo: f32,
    cfg: Config,
    last_rms: f32,
}

impl Vc {
    const fn new() -> Self {
        Vc {
            fs: 48000.0,
            input: [0.0; HOP],
            output: [0.0; HOP],
            dry: [0.0; HOP],
            pitch: Pitch::new(),
            ring: Ring::new(),
            tone: Tone::new(),
            lfo: 0.0,
            cfg: Config::new(),
            last_rms: 0.0,
        }
    }

    fn process(&mut self) {
        // Disabled: pass the microphone through untouched.
        if !self.cfg.enabled {
            self.output.copy_from_slice(&self.input);
            self.last_rms = rms(&self.output);
            return;
        }

        self.dry.copy_from_slice(&self.input);
        self.output.copy_from_slice(&self.input);

        // Vibrato modulates the pitch by a per-block LFO step.
        let mut st = self.cfg.pitch_st;
        if self.cfg.vib_hz > 0.0 && self.cfg.vib_depth > 0.0 {
            st += self.cfg.vib_depth * sinf(self.lfo);
            self.lfo += 2.0 * PI * self.cfg.vib_hz * (HOP as f32) / self.fs;
            if self.lfo > 2.0 * PI {
                self.lfo -= 2.0 * PI;
            }
        }
        let ratio = powf(2.0, st / 12.0);

        // Skip the shifter when effectively at unison so pitch-neutral presets
        // (e.g. robot) stay transparent instead of picking up comb colouring.
        let vibrato_active = self.cfg.vib_hz > 0.0 && self.cfg.vib_depth > 0.0;
        if (ratio - 1.0).abs() > 1e-4 || vibrato_active {
            self.pitch.process(&mut self.output, ratio);
        }

        if self.cfg.ring_mix > 0.0 && self.cfg.ring_hz > 0.0 {
            self.ring
                .process(&mut self.output, self.fs, self.cfg.ring_hz, self.cfg.ring_mix);
        }

        if self.cfg.drive > 0.0 {
            waveshape(&mut self.output, self.cfg.drive);
        }

        self.tone
            .process(&mut self.output, self.fs, self.cfg.hp_hz, self.cfg.lp_hz);

        // Dry/wet blend, output gain and a final safety clamp.
        let wet = self.cfg.mix.clamp(0.0, 1.0);
        let g = self.cfg.gain;
        for i in 0..HOP {
            let y = (self.output[i] * wet + self.dry[i] * (1.0 - wet)) * g;
            self.output[i] = y.clamp(-1.0, 1.0);
        }

        self.last_rms = rms(&self.output);
    }
}

fn rms(block: &[f32]) -> f32 {
    let mut acc = 0.0f32;
    for &s in block {
        acc += s * s;
    }
    sqrtf(acc / (block.len() as f32))
}

static mut VC: Vc = Vc::new();

#[inline]
#[allow(clippy::missing_safety_doc)]
unsafe fn vc() -> &'static mut Vc {
    &mut *core::ptr::addr_of_mut!(VC)
}

// ----------------------------------------------------------------------------
// Exported C ABI (callable from JS / the AudioWorklet).
// ----------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vc_init(sample_rate: f32) {
    unsafe { vc().fs = sample_rate }
}

#[no_mangle]
pub extern "C" fn vc_frame_size() -> usize {
    HOP
}

#[no_mangle]
pub extern "C" fn vc_input_ptr() -> *mut f32 {
    unsafe { vc().input.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn vc_output_ptr() -> *mut f32 {
    unsafe { vc().output.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn vc_process() {
    unsafe { vc().process() }
}

#[no_mangle]
pub extern "C" fn vc_get_rms() -> f32 {
    unsafe { vc().last_rms }
}

#[no_mangle]
pub extern "C" fn vc_set_enabled(on: i32) {
    unsafe { vc().cfg.enabled = on != 0 }
}

#[no_mangle]
pub extern "C" fn vc_set_pitch(semitones: f32) {
    unsafe { vc().cfg.pitch_st = semitones.clamp(-24.0, 24.0) }
}

#[no_mangle]
pub extern "C" fn vc_set_drive(amount: f32) {
    unsafe { vc().cfg.drive = amount.clamp(0.0, 1.0) }
}

#[no_mangle]
pub extern "C" fn vc_set_ring(hz: f32, mix: f32) {
    unsafe {
        let c = &mut vc().cfg;
        c.ring_hz = hz.max(0.0);
        c.ring_mix = mix.clamp(0.0, 1.0);
    }
}

#[no_mangle]
pub extern "C" fn vc_set_vibrato(hz: f32, depth: f32) {
    unsafe {
        let c = &mut vc().cfg;
        c.vib_hz = hz.max(0.0);
        c.vib_depth = depth.max(0.0);
    }
}

#[no_mangle]
pub extern "C" fn vc_set_tone(highpass_hz: f32, lowpass_hz: f32) {
    unsafe {
        let c = &mut vc().cfg;
        c.hp_hz = highpass_hz.max(0.0);
        c.lp_hz = lowpass_hz.max(0.0);
    }
}

#[no_mangle]
pub extern "C" fn vc_set_mix(wet: f32) {
    unsafe { vc().cfg.mix = wet.clamp(0.0, 1.0) }
}

#[no_mangle]
pub extern "C" fn vc_set_gain(g: f32) {
    unsafe { vc().cfg.gain = g.clamp(0.0, 4.0) }
}
