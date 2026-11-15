//! Noise suppression + residual echo suppression.
//!
//! STFT with a 256-point FFT, Hann analysis window and 50% overlap (hop = 128).
//! A periodic Hann at 50% overlap sums to 1.0 (COLA), so a plain overlap-add on
//! synthesis reconstructs unity-gain audio.
//!
//! - Noise floor per bin: recursive minimum follower ("minimum statistics"
//!   lite), seeded from the first frames so it works immediately.
//! - Gain: decision-directed Wiener rule (Ephraim–Malah a-priori SNR), which
//!   tracks speech quickly while keeping musical noise low.
//! - Residual echo: when the AEC is on, its echo estimate is analysed with the
//!   same window and a share of its power is added to the noise to suppress
//!   what the linear filter could not cancel (non-linear speaker distortion).
//! - Only the non-redundant half spectrum is processed, and the mic and echo
//!   frames share a single complex FFT.

use crate::fft::{split, Fft, BINS};
use crate::{FFT_SIZE as N, HOP};

use core::f32::consts::PI;
use libm::{cosf, sqrtf};

/// Frames used to seed the noise estimate directly from the input at start-up.
const WARMUP: u32 = 8;
/// Decision-directed smoothing of the a-priori SNR.
const DD: f32 = 0.98;
/// Fraction of the echo estimate's power treated as residual echo.
const RES_LEAK: f32 = 0.5;
/// Residual gain floor (-22 dB) so the background never fully drops out.
const FLOOR: f32 = 0.08;

pub struct Ns {
    hann: [f32; N],
    in_buf: [f32; N],
    echo_buf: [f32; N],
    ola: [f32; N],
    re: [f32; N],
    im: [f32; N],
    p_smooth: [f32; BINS],
    p_min: [f32; BINS],
    clean_prev: [f32; BINS], // |G|^2 * power of the previous frame
    frames: u32,
}

impl Ns {
    pub const fn new() -> Self {
        Ns {
            hann: [0.0; N],
            in_buf: [0.0; N],
            echo_buf: [0.0; N],
            ola: [0.0; N],
            re: [0.0; N],
            im: [0.0; N],
            p_smooth: [1e-6; BINS],
            p_min: [1e-6; BINS],
            clean_prev: [0.0; BINS],
            frames: 0,
        }
    }

    pub fn init(&mut self) {
        for n in 0..N {
            // periodic Hann
            self.hann[n] = 0.5 - 0.5 * cosf(2.0 * PI * (n as f32) / (N as f32));
        }
    }

    /// Process one hop in place. `strength` in [0, 2] (0 = no noise
    /// reduction); `echo` = the AEC's echo estimate for this block, if any.
    pub fn process(&mut self, fft: &Fft, block: &mut [f32; HOP], strength: f32, echo: Option<&[f32; HOP]>) {
        // Slide the analysis frames: keep the previous hop, append the new one.
        self.in_buf.copy_within(HOP.., 0);
        self.in_buf[N - HOP..].copy_from_slice(block);
        self.echo_buf.copy_within(HOP.., 0);
        match echo {
            Some(e) => self.echo_buf[N - HOP..].copy_from_slice(e),
            None => self.echo_buf[N - HOP..].fill(0.0),
        }

        // Windowed mic (real part) + windowed echo (imag part) -> one FFT.
        for i in 0..N {
            self.re[i] = self.in_buf[i] * self.hann[i];
            self.im[i] = self.echo_buf[i] * self.hann[i];
        }
        fft.run(&mut self.re, &mut self.im, false);

        let alpha = 0.9f32; // power smoothing
        let leak = 1.0015f32; // how fast p_min may rise (recover to higher noise)
        let over = 2.0 * strength; // noise over-subtraction factor
        let res = if echo.is_some() { RES_LEAK } else { 0.0 };
        let floor = if over > 0.0 || res > 0.0 { FLOOR } else { 1.0 };
        let warm = self.frames < WARMUP;
        self.frames = self.frames.saturating_add(1);

        let (mut xr, mut xi) = ([0.0f32; BINS], [0.0f32; BINS]);
        for k in 0..BINS {
            let ((ar, ai), (br, bi)) = split(&self.re, &self.im, k);
            let power = ar * ar + ai * ai + 1e-12;
            let echo_pow = br * br + bi * bi;

            self.p_smooth[k] = if warm { power } else { alpha * self.p_smooth[k] + (1.0 - alpha) * power };
            if warm || self.p_smooth[k] < self.p_min[k] {
                self.p_min[k] = self.p_smooth[k];
            } else {
                self.p_min[k] *= leak;
            }

            // Decision-directed Wiener gain against noise + residual echo.
            let interference = over * 1.5 * self.p_min[k] + res * echo_pow + 1e-12;
            let post_snr = power / interference;
            let prio_snr = DD * self.clean_prev[k] / interference + (1.0 - DD) * (post_snr - 1.0).max(0.0);
            let g = (prio_snr / (1.0 + prio_snr)).max(floor);
            self.clean_prev[k] = g * g * power;
            xr[k] = ar * g;
            xi[k] = ai * g;
        }

        // Rebuild the Hermitian spectrum and return to the time domain.
        for k in 0..BINS {
            self.re[k] = xr[k];
            self.im[k] = xi[k];
            if k > 0 && k < N / 2 {
                self.re[N - k] = xr[k];
                self.im[N - k] = -xi[k];
            }
        }
        fft.run(&mut self.re, &mut self.im, true);

        // Overlap-add, emit one hop, shift the accumulator.
        let scale = 1.0 / (N as f32);
        for i in 0..N {
            self.ola[i] += self.re[i] * scale;
        }
        block.copy_from_slice(&self.ola[..HOP]);
        self.ola.copy_within(HOP.., 0);
        self.ola[N - HOP..].fill(0.0);
    }
}

/// Frame RMS helper used by several modules.
pub fn rms(block: &[f32]) -> f32 {
    let acc: f32 = block.iter().map(|s| s * s).sum();
    sqrtf(acc / (block.len() as f32))
}
