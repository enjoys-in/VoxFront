//! Custom acoustic echo cancellation via a normalized least-mean-squares
//! (NLMS) adaptive FIR filter.
//!
//! The far-end (loudspeaker / agent TTS) signal is the *reference*. We adapt a
//! filter that predicts the echo of that reference picked up by the mic, then
//! subtract it. A light double-talk guard freezes adaptation when the near-end
//! talker dominates, preventing divergence.

use crate::HOP;

const TAPS: usize = 1024; // ~21 ms at 48 kHz

pub struct Aec {
    w: [f32; TAPS],     // adaptive weights
    x: [f32; TAPS],     // reference history, x[0] = newest
    energy: f32,        // running reference energy estimate
}

impl Aec {
    pub const fn new() -> Self {
        Aec {
            w: [0.0; TAPS],
            x: [0.0; TAPS],
            energy: 1e-6,
        }
    }

    /// Cancel echo of `reference` from `mic`, writing the residual back into
    /// `mic`. `mu` is the adaptation step (0..1); typical 0.3.
    pub fn process(&mut self, mic: &mut [f32; HOP], reference: &[f32; HOP], mu: f32) {
        for n in 0..HOP {
            // Shift reference history and insert the newest sample.
            let mut i = TAPS - 1;
            while i > 0 {
                self.x[i] = self.x[i - 1];
                i -= 1;
            }
            self.x[0] = reference[n];

            // Estimated echo y = w . x
            let mut y = 0.0f32;
            for k in 0..TAPS {
                y += self.w[k] * self.x[k];
            }

            let d = mic[n];
            let e = d - y; // residual (echo-cancelled near-end)
            mic[n] = e;

            // Track reference power for normalization.
            self.energy = 0.999 * self.energy + 0.001 * (reference[n] * reference[n]);
            let norm: f32 = self.energy * (TAPS as f32) + 1e-3;

            // Double-talk guard: if the residual is much larger than the
            // estimated echo, the near-end is talking — slow the update down.
            let dt = if e * e > 4.0 * (y * y + 1e-9) { 0.1 } else { 1.0 };
            let step = mu * dt * e / norm;

            // NLMS weight update.
            for k in 0..TAPS {
                self.w[k] += step * self.x[k];
            }
        }
    }
}
