//! Fixed-size (N = 256) radix-2 complex FFT with precomputed twiddle and
//! bit-reversal tables (no_std, no alloc), plus helpers to run two *real*
//! signals through one complex transform.

use crate::FFT_SIZE as N;
use core::f32::consts::PI;
use libm::{cosf, sinf};

/// Non-redundant bins of a real signal's spectrum (0..=N/2).
pub const BINS: usize = N / 2 + 1;

pub struct Fft {
    cos: [f32; N / 2],
    sin: [f32; N / 2],
    rev: [u16; N],
}

impl Fft {
    pub const fn new() -> Self {
        Fft { cos: [0.0; N / 2], sin: [0.0; N / 2], rev: [0; N] }
    }

    /// Build the tables. Must run once before [`Fft::run`].
    pub fn init(&mut self) {
        for k in 0..N / 2 {
            let a = -2.0 * PI * (k as f32) / (N as f32);
            self.cos[k] = cosf(a);
            self.sin[k] = sinf(a);
        }
        let shift = 32 - N.trailing_zeros();
        for i in 0..N {
            self.rev[i] = ((i as u32).reverse_bits() >> shift) as u16;
        }
    }

    /// In-place FFT. `inverse = true` computes the IFFT without 1/N scaling.
    pub fn run(&self, re: &mut [f32; N], im: &mut [f32; N], inverse: bool) {
        for i in 0..N {
            let j = self.rev[i] as usize;
            if i < j {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let sign = if inverse { -1.0 } else { 1.0 };
        let mut len = 2;
        while len <= N {
            let half = len / 2;
            let stride = N / len;
            let mut i = 0;
            while i < N {
                for k in 0..half {
                    let (wr, wi) = (self.cos[k * stride], sign * self.sin[k * stride]);
                    let (a, b) = (i + k, i + k + half);
                    let vr = re[b] * wr - im[b] * wi;
                    let vi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - vr;
                    im[b] = im[a] - vi;
                    re[a] += vr;
                    im[a] += vi;
                }
                i += len;
            }
            len <<= 1;
        }
    }
}

/// After `run(forward)` on `a + j·b` (a, b real), recover bin `k` of A and B:
/// A[k] = (Z[k] + Z*[N-k]) / 2,  B[k] = (Z[k] - Z*[N-k]) / 2j.
#[inline]
pub fn split(re: &[f32; N], im: &[f32; N], k: usize) -> ((f32, f32), (f32, f32)) {
    let m = (N - k) % N;
    let a = (0.5 * (re[k] + re[m]), 0.5 * (im[k] - im[m]));
    let b = (0.5 * (im[k] + im[m]), 0.5 * (re[m] - re[k]));
    (a, b)
}

/// Inverse of [`split`]: write Hermitian bin `k` of A and B as Z = A + j·B so a
/// single inverse `run` yields `a` in `re` and `b` in `im`.
#[inline]
pub fn join(re: &mut [f32; N], im: &mut [f32; N], k: usize, a: (f32, f32), b: (f32, f32)) {
    let m = (N - k) % N;
    re[m] = a.0 + b.1;
    im[m] = b.0 - a.1;
    re[k] = a.0 - b.1;
    im[k] = a.1 + b.0;
}
