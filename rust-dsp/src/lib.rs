//! Browser VoIP DSP — WebAssembly core.
//!
//! A single global processor instance operates on shared linear-memory buffers.
//! The JavaScript/AudioWorklet host writes one 128-sample quantum into the
//! input buffer (and optionally the far-end reference buffer), calls
//! [`dsp_process`], then reads the processed quantum back from the output
//! buffer plus the status getters.
//!
//! Signal chain per quantum:
//!   input -> DC block -> AEC -> DTMF detect -> noise + residual-echo
//!   suppression -> VAD -> AGC -> compressor -> effects -> VAD gate ->
//!   limiter -> output

mod aec;
mod agc;
mod dtmf;
mod effects;
mod fft;
mod ns;
mod vad;

use aec::Aec;
use agc::{Agc, Compressor, Limiter};
use dtmf::Dtmf;
use effects::{DcBlocker, Effects};
use fft::Fft;
use vad::Vad;

/// AudioWorklet render quantum.
pub const HOP: usize = 128;
/// STFT size used by the noise suppressor.
pub const FFT_SIZE: usize = 256;

struct Config {
    aec_on: bool,
    aec_mu: f32,
    ns_on: bool,
    ns_strength: f32,
    agc_on: bool,
    agc_target: f32,
    comp_on: bool,
    comp_threshold: f32,
    comp_ratio: f32,
    comp_makeup: f32,
    vad_on: bool,
    vad_sensitivity: f32,
    vad_gate: bool,
    fx_hp: bool,
    fx_echo: bool,
    fx_delay: usize,
    fx_fb: f32,
    fx_mix: f32,
}

impl Config {
    const fn new() -> Self {
        Config {
            aec_on: false,
            aec_mu: 0.3,
            ns_on: true,
            ns_strength: 1.0,
            agc_on: true,
            agc_target: 0.12,
            comp_on: false,
            comp_threshold: 0.3,
            comp_ratio: 3.0,
            comp_makeup: 1.2,
            vad_on: true,
            vad_sensitivity: 0.5,
            vad_gate: false,
            fx_hp: true,
            fx_echo: false,
            fx_delay: 9600,
            fx_fb: 0.3,
            fx_mix: 0.4,
        }
    }
}

struct Dsp {
    sample_rate: f32,
    input: [f32; HOP],
    output: [f32; HOP],
    reference: [f32; HOP],
    work: [f32; HOP],
    fft: Fft,
    dc: DcBlocker,
    ns: ns::Ns,
    agc: Agc,
    comp: Compressor,
    limiter: Limiter,
    vad: Vad,
    dtmf: Dtmf,
    cfg: Config,
    bypass: bool,
    gate_gain: f32,
    vad_active: bool,
    last_rms: f32,
    last_dtmf: i32,
}

impl Dsp {
    const fn new() -> Self {
        Dsp {
            sample_rate: 48000.0,
            input: [0.0; HOP],
            output: [0.0; HOP],
            reference: [0.0; HOP],
            work: [0.0; HOP],
            fft: Fft::new(),
            dc: DcBlocker::new(),
            ns: ns::Ns::new(),
            agc: Agc::new(),
            comp: Compressor::new(),
            limiter: Limiter::new(),
            vad: Vad::new(),
            dtmf: Dtmf::new(),
            cfg: Config::new(),
            bypass: false,
            gate_gain: 1.0,
            vad_active: true,
            last_rms: 0.0,
            last_dtmf: -1,
        }
    }

    fn process(&mut self) {
        self.work.copy_from_slice(&self.input);

        // Master bypass: emit raw input untouched so the user can A/B the whole
        // preprocessing chain against the unprocessed microphone.
        if self.bypass {
            self.output.copy_from_slice(&self.input);
            self.vad_active = true;
            self.last_rms = ns::rms(&self.output);
            return;
        }

        let big = unsafe { big() };
        self.dc.process(&mut self.work);

        if self.cfg.aec_on {
            big.aec.process(&self.fft, &mut self.work, &self.reference, self.cfg.aec_mu);
        }

        // DTMF runs on the echo-cancelled but otherwise unmodified signal so the
        // tones are not attenuated by noise suppression.
        let key = self.dtmf.process(&self.work);
        if key >= 0 {
            self.last_dtmf = key;
        }

        // The spectral stage also removes residual echo, so it runs whenever
        // either noise suppression or echo cancellation is enabled.
        if self.cfg.ns_on || self.cfg.aec_on {
            let strength = if self.cfg.ns_on { self.cfg.ns_strength } else { 0.0 };
            let echo = if self.cfg.aec_on { Some(big.aec.echo()) } else { None };
            self.ns.process(&self.fft, &mut self.work, strength, echo);
        }

        self.vad_active = if self.cfg.vad_on {
            self.vad.process(&self.work, self.cfg.vad_sensitivity)
        } else {
            true
        };

        if self.cfg.agc_on {
            self.agc.process(&mut self.work, self.cfg.agc_target);
        }
        if self.cfg.comp_on {
            self.comp.process(
                &mut self.work,
                self.cfg.comp_threshold,
                self.cfg.comp_ratio,
                self.cfg.comp_makeup,
            );
        }

        big.fx.process(
            &mut self.work,
            self.cfg.fx_hp,
            self.cfg.fx_echo,
            self.cfg.fx_delay,
            self.cfg.fx_fb,
            self.cfg.fx_mix,
        );

        // Smoothly gate the output when VAD says there is no speech: open fast
        // (~2 ms) so word onsets survive, close slowly (~40 ms) to avoid clicks.
        let target_gate = if self.cfg.vad_on && self.cfg.vad_gate && !self.vad_active {
            0.0
        } else {
            1.0
        };
        for i in 0..HOP {
            let c = if target_gate > self.gate_gain { 0.01 } else { 0.0005 };
            self.gate_gain += c * (target_gate - self.gate_gain);
            self.output[i] = self.work[i] * self.gate_gain;
        }
        self.limiter.process(&mut self.output);

        self.last_rms = ns::rms(&self.output);
    }
}

static mut DSP: Dsp = Dsp::new();

/// Large state (~220 KB: AEC filters + echo-effect delay line) that starts
/// all-zero. Kept apart from `DSP`, whose non-zero defaults would otherwise
/// force every byte of it into the .wasm file instead of .bss.
struct Big {
    aec: Aec,
    fx: Effects,
}

static mut BIG: Big = Big { aec: Aec::new(), fx: Effects::new() };

#[inline]
#[allow(clippy::missing_safety_doc)]
unsafe fn dsp() -> &'static mut Dsp {
    &mut *core::ptr::addr_of_mut!(DSP)
}

#[inline]
#[allow(clippy::missing_safety_doc)]
unsafe fn big() -> &'static mut Big {
    &mut *core::ptr::addr_of_mut!(BIG)
}

// ----------------------------------------------------------------------------
// Exported C ABI (callable from JS / the AudioWorklet).
// ----------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn dsp_init(sample_rate: f32) {
    unsafe {
        let d = dsp();
        d.sample_rate = sample_rate;
        d.fft.init();
        d.ns.init();
        d.dtmf.init(sample_rate);
        big().fx.init(sample_rate);
    }
}

#[no_mangle]
pub extern "C" fn dsp_frame_size() -> usize {
    HOP
}

#[no_mangle]
pub extern "C" fn dsp_input_ptr() -> *mut f32 {
    unsafe { dsp().input.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn dsp_output_ptr() -> *mut f32 {
    unsafe { dsp().output.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn dsp_reference_ptr() -> *mut f32 {
    unsafe { dsp().reference.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn dsp_process() {
    unsafe { dsp().process() }
}

#[no_mangle]
pub extern "C" fn dsp_get_vad() -> i32 {
    unsafe { dsp().vad_active as i32 }
}

#[no_mangle]
pub extern "C" fn dsp_get_rms() -> f32 {
    unsafe { dsp().last_rms }
}

#[no_mangle]
pub extern "C" fn dsp_get_noise_floor() -> f32 {
    unsafe { dsp().vad.noise_floor() }
}

#[no_mangle]
pub extern "C" fn dsp_get_gain() -> f32 {
    unsafe { dsp().agc.current_gain() }
}

/// Echo return loss enhancement of the AEC in dB (0 when idle/disabled).
#[no_mangle]
pub extern "C" fn dsp_get_erle() -> f32 {
    unsafe {
        let d = dsp();
        if d.cfg.aec_on && !d.bypass { big().aec.erle_db() } else { 0.0 }
    }
}

/// Returns a freshly detected DTMF key index (0..15) once, then -1.
#[no_mangle]
pub extern "C" fn dsp_get_dtmf() -> i32 {
    unsafe {
        let d = dsp();
        let k = d.last_dtmf;
        d.last_dtmf = -1;
        k
    }
}

#[no_mangle]
pub extern "C" fn dsp_set_bypass(on: i32) {
    unsafe { dsp().bypass = on != 0 }
}

#[no_mangle]
pub extern "C" fn dsp_set_aec(on: i32, mu: f32) {
    unsafe {
        let c = &mut dsp().cfg;
        c.aec_on = on != 0;
        c.aec_mu = mu;
    }
}

#[no_mangle]
pub extern "C" fn dsp_set_ns(on: i32, strength: f32) {
    unsafe {
        let c = &mut dsp().cfg;
        c.ns_on = on != 0;
        c.ns_strength = strength;
    }
}

#[no_mangle]
pub extern "C" fn dsp_set_agc(on: i32, target_rms: f32) {
    unsafe {
        let c = &mut dsp().cfg;
        c.agc_on = on != 0;
        c.agc_target = target_rms;
    }
}

#[no_mangle]
pub extern "C" fn dsp_set_compressor(on: i32, threshold: f32, ratio: f32, makeup: f32) {
    unsafe {
        let c = &mut dsp().cfg;
        c.comp_on = on != 0;
        c.comp_threshold = threshold;
        c.comp_ratio = ratio;
        c.comp_makeup = makeup;
    }
}

#[no_mangle]
pub extern "C" fn dsp_set_vad(on: i32, sensitivity: f32, gate: i32) {
    unsafe {
        let c = &mut dsp().cfg;
        c.vad_on = on != 0;
        c.vad_sensitivity = sensitivity;
        c.vad_gate = gate != 0;
    }
}

#[no_mangle]
pub extern "C" fn dsp_set_effects(hp: i32, echo: i32, delay_samples: i32, feedback: f32, mix: f32) {
    unsafe {
        let c = &mut dsp().cfg;
        c.fx_hp = hp != 0;
        c.fx_echo = echo != 0;
        c.fx_delay = if delay_samples < 1 { 1 } else { delay_samples as usize };
        c.fx_fb = feedback;
        c.fx_mix = mix;
    }
}
