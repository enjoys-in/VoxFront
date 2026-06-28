//! Colour effects layered on top of the pitch shifter: a ring modulator
//! (robot / alien timbre), a tanh waveshaper (villain grit) and a one-pole
//! high-pass + low-pass tone control.

use core::f32::consts::PI;
use libm::{sinf, tanhf};

/// Ring modulator: multiplies the signal by a sine carrier and blends it back.
pub struct Ring {
    phase: f32,
}

impl Ring {
    pub const fn new() -> Self {
        Ring { phase: 0.0 }
    }

    pub fn process(&mut self, block: &mut [f32], fs: f32, hz: f32, mix: f32) {
        let inc = 2.0 * PI * hz / fs;
        for s in block.iter_mut() {
            let carrier = sinf(self.phase);
            self.phase += inc;
            if self.phase > 2.0 * PI {
                self.phase -= 2.0 * PI;
            }
            let ringed = *s * carrier;
            *s = *s * (1.0 - mix) + ringed * mix;
        }
    }
}

/// Soft-clipping waveshaper. `drive` in [0, 1] maps to a tanh gain of 1..12,
/// normalized so the output stays roughly in [-1, 1].
pub fn waveshape(block: &mut [f32], drive: f32) {
    let k = 1.0 + drive * 11.0;
    let norm = tanhf(k);
    for s in block.iter_mut() {
        *s = tanhf(k * *s) / norm;
    }
}

/// Cascaded one-pole high-pass then low-pass. A cutoff <= 0 disables that stage.
pub struct Tone {
    lp_for_hp: f32,
    lp: f32,
}

impl Tone {
    pub const fn new() -> Self {
        Tone {
            lp_for_hp: 0.0,
            lp: 0.0,
        }
    }

    pub fn process(&mut self, block: &mut [f32], fs: f32, hp_hz: f32, lp_hz: f32) {
        let do_hp = hp_hz > 0.0;
        let do_lp = lp_hz > 0.0 && lp_hz < fs * 0.5;
        let a_hp = if do_hp { alpha(hp_hz, fs) } else { 0.0 };
        let a_lp = if do_lp { alpha(lp_hz, fs) } else { 0.0 };
        for s in block.iter_mut() {
            let mut x = *s;
            if do_hp {
                // High-pass = input minus its own low-pass.
                self.lp_for_hp += a_hp * (x - self.lp_for_hp);
                x -= self.lp_for_hp;
            }
            if do_lp {
                self.lp += a_lp * (x - self.lp);
                x = self.lp;
            }
            *s = x;
        }
    }
}

/// One-pole smoothing coefficient for a cutoff `fc` at sample rate `fs`.
fn alpha(fc: f32, fs: f32) -> f32 {
    let w = 2.0 * PI * fc / fs;
    (w / (w + 1.0)).clamp(0.0, 1.0)
}
