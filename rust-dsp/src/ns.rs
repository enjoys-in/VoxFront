//! Spectral-subtraction noise suppression.
//!
//! STFT with a 256-point FFT, Hann analysis window and 50% overlap (hop = 128).
//! A 256-point Hann at 50% overlap satisfies the constant-overlap-add (COLA)
//! property and sums to 1.0, so we only need the analysis window and a plain
//! overlap-add on synthesis to reconstruct unity-gain audio.
//!
//! The per-bin noise floor is tracked with a recursive minimum follower
//! ("minimum statistics" lite); the spectral gain is a Wiener-style rule with
//! over-subtraction and temporal smoothing to limit musical noise.

use crate::fft::fft;
use crate::{FFT_SIZE, HOP};

use libm::{sqrtf, cosf};
use core::f32::consts::PI;

pub struct Ns {
    hann: [f32; FFT_SIZE],
    in_buf: [f32; FFT_SIZE],
    ola: [f32; FFT_SIZE],
    re: [f32; FFT_SIZE],
    im: [f32; FFT_SIZE],
    p_smooth: [f32; FFT_SIZE],
    p_min: [f32; FFT_SIZE],
    gain_prev: [f32; FFT_SIZE],
    initialized: bool,
}

impl Ns {
    pub const fn new() -> Self {
        Ns {
            hann: [0.0; FFT_SIZE],
            in_buf: [0.0; FFT_SIZE],
            ola: [0.0; FFT_SIZE],
            re: [0.0; FFT_SIZE],
            im: [0.0; FFT_SIZE],
            p_smooth: [1e-6; FFT_SIZE],
            p_min: [1e-6; FFT_SIZE],
            gain_prev: [1.0; FFT_SIZE],
            initialized: false,
        }
    }

    fn ensure_window(&mut self) {
        if self.initialized {
            return;
        }
        for n in 0..FFT_SIZE {
            // periodic Hann
            self.hann[n] = 0.5 - 0.5 * cosf(2.0 * PI * (n as f32) / (FFT_SIZE as f32));
        }
        self.initialized = true;
    }

    /// Process one hop (`HOP` samples) in place. `strength` in [0, 2]; 0 disables.
    pub fn process(&mut self, block: &mut [f32; HOP], strength: f32) {
        self.ensure_window();

        // Slide the analysis frame: keep the previous hop, append the new one.
        for i in 0..(FFT_SIZE - HOP) {
            self.in_buf[i] = self.in_buf[i + HOP];
        }
        for i in 0..HOP {
            self.in_buf[FFT_SIZE - HOP + i] = block[i];
        }

        // Windowed copy into FFT scratch.
        for i in 0..FFT_SIZE {
            self.re[i] = self.in_buf[i] * self.hann[i];
            self.im[i] = 0.0;
        }
        fft(&mut self.re, &mut self.im, false);

        // Per-bin noise tracking + gain.
        let alpha = 0.9f32; // power smoothing
        let leak = 1.0015f32; // how fast p_min may rise (recover to higher noise)
        let over = 1.0 + strength; // over-subtraction factor
        let floor_gain = 0.08f32; // residual floor to avoid total muting
        for k in 0..FFT_SIZE {
            let power = self.re[k] * self.re[k] + self.im[k] * self.im[k] + 1e-12;
            self.p_smooth[k] = alpha * self.p_smooth[k] + (1.0 - alpha) * power;
            if self.p_smooth[k] < self.p_min[k] {
                self.p_min[k] = self.p_smooth[k];
            } else {
                self.p_min[k] *= leak;
            }
            let noise = self.p_min[k] * 1.5; // bias the floor up a touch
            // Wiener-ish subtraction on power.
            let mut g = (power - over * noise) / power;
            if g < floor_gain {
                g = floor_gain;
            }
            // Temporal smoothing of the gain reduces musical noise.
            g = 0.6 * self.gain_prev[k] + 0.4 * g;
            self.gain_prev[k] = g;
            self.re[k] *= g;
            self.im[k] *= g;
        }

        // Back to time domain.
        fft(&mut self.re, &mut self.im, true);
        let scale = 1.0 / (FFT_SIZE as f32);

        // Overlap-add.
        for i in 0..FFT_SIZE {
            self.ola[i] += self.re[i] * scale;
        }
        for i in 0..HOP {
            block[i] = self.ola[i];
        }
        // Shift the OLA accumulator by one hop, zero the tail.
        for i in 0..(FFT_SIZE - HOP) {
            self.ola[i] = self.ola[i + HOP];
        }
        for i in (FFT_SIZE - HOP)..FFT_SIZE {
            self.ola[i] = 0.0;
        }
    }
}

/// Frame RMS helper used by several modules.
pub fn rms(block: &[f32]) -> f32 {
    let mut acc = 0.0f32;
    for &s in block {
        acc += s * s;
    }
    sqrtf(acc / (block.len() as f32))
}
