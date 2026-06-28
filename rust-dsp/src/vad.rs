//! Voice activity detection.
//!
//! Combines an adaptive noise-floor energy test with a zero-crossing-rate test
//! (to catch low-energy unvoiced fricatives) and adds a hangover so speech
//! tails are not clipped.

use crate::ns::rms;
use crate::HOP;

pub struct Vad {
    noise_rms: f32,
    hang: i32,
    active: bool,
}

impl Vad {
    pub const fn new() -> Self {
        Vad {
            noise_rms: 0.01,
            hang: 0,
            active: false,
        }
    }

    pub fn noise_floor(&self) -> f32 {
        self.noise_rms
    }

    /// Returns true while speech is considered present. `sensitivity` in
    /// [0,1] raises detection aggressiveness.
    pub fn process(&mut self, block: &[f32; HOP], sensitivity: f32) -> bool {
        let level = rms(block);

        // Zero-crossing rate (normalized 0..1).
        let mut zc = 0usize;
        for i in 1..HOP {
            if (block[i] >= 0.0) != (block[i - 1] >= 0.0) {
                zc += 1;
            }
        }
        let zcr = zc as f32 / (HOP as f32);

        // factor shrinks with sensitivity: 1.8 (aggressive) .. 4.0 (conservative)
        let factor = 4.0 - 2.2 * sensitivity.clamp(0.0, 1.0);
        let energy_speech = level > self.noise_rms * factor && level > 0.004;
        // Unvoiced speech: moderate energy with high ZCR.
        let unvoiced = zcr > 0.25 && level > self.noise_rms * 2.0;
        let speech = energy_speech || unvoiced;

        if speech {
            self.hang = 12; // ~ frames of hangover
        } else if self.hang > 0 {
            self.hang -= 1;
        }
        self.active = speech || self.hang > 0;

        // Adapt the noise floor only when we are confident it's not speech.
        if !self.active {
            self.noise_rms = 0.95 * self.noise_rms + 0.05 * level;
        } else {
            // Allow a very slow rise so a rising noise bed is tracked.
            self.noise_rms = 0.999 * self.noise_rms + 0.001 * level.min(self.noise_rms * 1.5);
        }
        // Keep the floor sane.
        if self.noise_rms < 1e-4 {
            self.noise_rms = 1e-4;
        }

        self.active
    }
}
