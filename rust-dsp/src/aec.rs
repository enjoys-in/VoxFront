//! Acoustic echo cancellation: partitioned-block frequency-domain adaptive
//! filter (PBFDAF, overlap-save) with a two-filter double-talk scheme.
//!
//! - The far-end (loudspeaker / agent TTS) signal is the *reference*; the
//!   filter learns the echo path from it to the mic and subtracts the echo.
//! - `PARTS` partitions of `HOP` taps give a ~107 ms tail at 48 kHz — long
//!   enough for real browser output+input latency — for less CPU than the old
//!   21 ms time-domain NLMS, because convolution and adaptation run per bin.
//! - A *background* filter always adapts; a *foreground* filter produces the
//!   output. The background is promoted when it is clearly better and reset
//!   from the foreground when it diverges (near-end speech during double
//!   talk), so talking over the far end never wrecks the echo estimate.
//! - The gradient constraint (true linear convolution) is applied to two
//!   partitions per block, round-robin, to keep the cost flat.

use crate::fft::{join, split, Fft, BINS};
use crate::{FFT_SIZE as N, HOP};
use libm::log10f;

const PARTS: usize = 40; // 40 * 128 = 5120 taps
/// Regularisation of the per-bin step (≈ -60 dBFS reference floor).
const DELTA: f32 = (N as f32) * 1e-6;
/// Block energy below which the far end is treated as silent (no adaptation).
const FAR_SILENT: f32 = (HOP as f32) * 1e-7;

#[derive(Clone, Copy)]
struct Spec {
    re: [f32; BINS],
    im: [f32; BINS],
}

impl Spec {
    const ZERO: Spec = Spec { re: [0.0; BINS], im: [0.0; BINS] };
}

pub struct Aec {
    x_prev: [f32; HOP],    // previous reference block (overlap-save input)
    xh: [Spec; PARTS],     // reference spectra, ring buffer, `head` = newest
    head: usize,
    wb: [Spec; PARTS],     // background (adapting) filter
    wf: [Spec; PARTS],     // foreground (output) filter
    px: [f32; BINS],       // smoothed reference power per bin
    sb: f32,               // smoothed background error energy
    sf: f32,               // smoothed foreground error energy
    sd: f32,               // smoothed mic energy
    erle: f32,             // echo return loss enhancement (linear power ratio)
    next_constrain: usize, // round-robin constraint cursor
    echo: [f32; HOP],      // foreground echo estimate (for residual suppression)
    re: [f32; N],
    im: [f32; N],
}

impl Aec {
    /// All-zero initial state (lets the global live in .bss, not the .wasm file).
    pub const fn new() -> Self {
        Aec {
            x_prev: [0.0; HOP],
            xh: [Spec::ZERO; PARTS],
            head: 0,
            wb: [Spec::ZERO; PARTS],
            wf: [Spec::ZERO; PARTS],
            px: [0.0; BINS],
            sb: 0.0,
            sf: 0.0,
            sd: 0.0,
            erle: 0.0,
            next_constrain: 0,
            echo: [0.0; HOP],
            re: [0.0; N],
            im: [0.0; N],
        }
    }

    /// Latest echo estimate subtracted from the mic (same samples as the block).
    pub fn echo(&self) -> &[f32; HOP] {
        &self.echo
    }

    /// Echo reduction achieved by the linear filter, in dB.
    pub fn erle_db(&self) -> f32 {
        10.0 * log10f(self.erle.max(1.0))
    }

    /// Cancel echo of `reference` from `mic` in place. `mu` (0..1) scales the
    /// adaptation speed; typical 0.3.
    pub fn process(&mut self, fft: &Fft, mic: &mut [f32; HOP], reference: &[f32; HOP], mu: f32) {
        // 1. Spectrum of the last two reference blocks -> newest history slot.
        self.re[..HOP].copy_from_slice(&self.x_prev);
        self.re[HOP..].copy_from_slice(reference);
        self.im = [0.0; N];
        fft.run(&mut self.re, &mut self.im, false);
        self.x_prev = *reference;
        self.head = (self.head + PARTS - 1) % PARTS;
        let x = &mut self.xh[self.head];
        for k in 0..BINS {
            x.re[k] = self.re[k];
            x.im[k] = self.im[k];
            let p = x.re[k] * x.re[k] + x.im[k] * x.im[k];
            self.px[k] = 0.9 * self.px[k] + 0.1 * p;
        }
        let far_energy: f32 = reference.iter().map(|s| s * s).sum();

        // 2. Echo estimates of both filters: Y = sum_p W_p * X_p, then one IFFT
        //    of Yb + j·Yf returns both time signals (overlap-save keeps the tail).
        let (mut yb, mut yf) = (Spec::ZERO, Spec::ZERO);
        for p in 0..PARTS {
            let x = &self.xh[(self.head + p) % PARTS];
            let (b, f) = (&self.wb[p], &self.wf[p]);
            for k in 0..BINS {
                yb.re[k] += b.re[k] * x.re[k] - b.im[k] * x.im[k];
                yb.im[k] += b.re[k] * x.im[k] + b.im[k] * x.re[k];
                yf.re[k] += f.re[k] * x.re[k] - f.im[k] * x.im[k];
                yf.im[k] += f.re[k] * x.im[k] + f.im[k] * x.re[k];
            }
        }
        for k in 0..BINS {
            join(&mut self.re, &mut self.im, k, (yb.re[k], yb.im[k]), (yf.re[k], yf.im[k]));
        }
        fft.run(&mut self.re, &mut self.im, true);

        // 3. Errors. The foreground residual is the output.
        let scale = 1.0 / N as f32;
        let mut eb = [0.0f32; HOP];
        let (mut e_b, mut e_f, mut e_d) = (0.0f32, 0.0f32, 0.0f32);
        for n in 0..HOP {
            let d = mic[n];
            eb[n] = d - self.re[HOP + n] * scale;
            self.echo[n] = self.im[HOP + n] * scale;
            let ef = d - self.echo[n];
            mic[n] = ef;
            e_b += eb[n] * eb[n];
            e_f += ef * ef;
            e_d += d * d;
        }
        self.sb = 0.9 * self.sb + 0.1 * e_b;
        self.sf = 0.9 * self.sf + 0.1 * e_f;
        self.sd = 0.9 * self.sd + 0.1 * e_d;

        if far_energy < FAR_SILENT {
            return; // nothing to learn from
        }
        let ratio = (self.sd + 1e-9) / (self.sf + 1e-9);
        self.erle = 0.95 * self.erle + 0.05 * ratio.clamp(1.0, 1e6);

        // 4. Adapt the background filter, proportionately: partitions that
        //    already hold echo energy get a larger share of the step (fast
        //    convergence when the echo arrives after a bulk delay).
        //    W_p += mu * share_p * conj(X_p) * E / Px.
        let mut norm = [0.0f32; PARTS];
        for p in 0..PARTS {
            let w = &self.wb[p];
            // Every 4th bin is plenty to rank partitions and keeps this cheap.
            norm[p] = (0..BINS).step_by(4).map(|k| w.re[k].abs() + w.im[k].abs()).sum();
        }
        let total: f32 = norm.iter().sum::<f32>() + 1e-6;
        self.re[..HOP].fill(0.0);
        self.re[HOP..].copy_from_slice(&eb);
        self.im = [0.0; N];
        fft.run(&mut self.re, &mut self.im, false);
        let mut step = [0.0f32; BINS];
        for k in 0..BINS {
            step[k] = mu / (self.px[k] + DELTA);
        }
        for p in 0..PARTS {
            let share = 0.5 / PARTS as f32 + 0.5 * norm[p] / total;
            let x = &self.xh[(self.head + p) % PARTS];
            let w = &mut self.wb[p];
            for k in 0..BINS {
                let (er, ei) = (self.re[k] * step[k] * share, self.im[k] * step[k] * share);
                w.re[k] += x.re[k] * er + x.im[k] * ei;
                w.im[k] += x.re[k] * ei - x.im[k] * er;
            }
        }
        self.constrain_next(fft);

        // 5. Two-filter control: promote a clearly better background, reset a
        //    diverged one (double talk) from the trusted foreground.
        if self.sb < 0.7 * self.sf {
            self.wf = self.wb;
            self.sf = self.sb;
        } else if self.sb > 4.0 * self.sf && self.sf < self.sd {
            self.wb = self.wf;
            self.sb = self.sf;
        }
    }

    /// Zero the second half of the impulse response of two background
    /// partitions (packed into one IFFT/FFT pair).
    fn constrain_next(&mut self, fft: &Fft) {
        let (p, q) = (self.next_constrain, self.next_constrain + 1);
        self.next_constrain = (self.next_constrain + 2) % PARTS;
        for k in 0..BINS {
            let (a, b) = (&self.wb[p], &self.wb[q]);
            join(&mut self.re, &mut self.im, k, (a.re[k], a.im[k]), (b.re[k], b.im[k]));
        }
        fft.run(&mut self.re, &mut self.im, true);
        let scale = 1.0 / N as f32;
        for n in 0..N {
            let keep = if n < HOP { scale } else { 0.0 };
            self.re[n] *= keep;
            self.im[n] *= keep;
        }
        fft.run(&mut self.re, &mut self.im, false);
        for k in 0..BINS {
            let (a, b) = split(&self.re, &self.im, k);
            self.wb[p].re[k] = a.0;
            self.wb[p].im[k] = a.1;
            self.wb[q].re[k] = b.0;
            self.wb[q].im[k] = b.1;
        }
    }
}
