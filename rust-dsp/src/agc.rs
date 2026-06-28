//! Automatic gain control (volume normalization) and a dynamic-range
//! compressor ("compress audio" in the pipeline diagram).

use crate::ns::rms;
use crate::HOP;
use libm::powf;

/// Automatic gain control: drive the block RMS toward a target with smooth
/// attack/release and a hold during near-silence (so we don't amplify noise).
pub struct Agc {
    gain: f32,
}

impl Agc {
    pub const fn new() -> Self {
        Agc { gain: 1.0 }
    }

    pub fn process(&mut self, block: &mut [f32; HOP], target_rms: f32) {
        let level = rms(block);
        // Below this we treat the frame as silence and hold the gain.
        let noise_gate = 0.003f32;
        let max_gain = 32.0f32; // ~30 dB
        let min_gain = 0.1f32;

        let desired = if level > noise_gate {
            (target_rms / (level + 1e-6)).clamp(min_gain, max_gain)
        } else {
            self.gain
        };

        // Faster to turn down (attack) than to turn up (release).
        let coeff = if desired < self.gain { 0.4 } else { 0.05 };
        self.gain += coeff * (desired - self.gain);

        for s in block.iter_mut() {
            *s *= self.gain;
        }
    }

    pub fn current_gain(&self) -> f32 {
        self.gain
    }
}

/// Feed-forward dynamic-range compressor with soft knee-free hard threshold,
/// attack/release envelope and makeup gain. Operates per sample.
pub struct Compressor {
    env: f32,
}

impl Compressor {
    pub const fn new() -> Self {
        Compressor { env: 0.0 }
    }

    /// `threshold` linear (e.g. 0.25), `ratio` >= 1 (e.g. 4.0), `makeup` linear.
    pub fn process(&mut self, block: &mut [f32; HOP], threshold: f32, ratio: f32, makeup: f32) {
        let attack = 0.25f32;
        let release = 0.02f32;
        let inv_ratio = 1.0 / ratio;

        for s in block.iter_mut() {
            let x = *s;
            let a = if x < 0.0 { -x } else { x };
            // Peak envelope follower.
            let coeff = if a > self.env { attack } else { release };
            self.env += coeff * (a - self.env);

            let mut gain = 1.0f32;
            if self.env > threshold {
                // Above threshold compress: out = thr * (env/thr)^(1/ratio).
                let over = self.env / threshold;
                let compressed = threshold * powf(over, inv_ratio);
                gain = compressed / self.env;
            }
            *s = x * gain * makeup;
        }
    }
}
