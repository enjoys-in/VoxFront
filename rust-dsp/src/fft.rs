//! Minimal radix-2 in-place complex FFT (no_std, no alloc).
//!
//! Operates on split real/imag arrays so the caller can keep them as plain
//! `[f32; N]` statics. `N` must be a power of two.

use libm::{cosf, sinf};

use core::f32::consts::PI;

/// In-place iterative radix-2 FFT. `inverse = true` computes the IFFT
/// (without the 1/N scaling — the caller scales when needed).
pub fn fft(re: &mut [f32], im: &mut [f32], inverse: bool) {
    let n = re.len();
    debug_assert!(n.is_power_of_two());
    debug_assert_eq!(im.len(), n);

    // Bit-reversal permutation.
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    // Danielson–Lanczos.
    let sign = if inverse { 1.0f32 } else { -1.0f32 };
    let mut len = 2usize;
    while len <= n {
        let ang = sign * 2.0 * PI / (len as f32);
        let wlen_re = cosf(ang);
        let wlen_im = sinf(ang);
        let half = len / 2;
        let mut i = 0usize;
        while i < n {
            let mut w_re = 1.0f32;
            let mut w_im = 0.0f32;
            for k in 0..half {
                let a = i + k;
                let b = i + k + half;
                let u_re = re[a];
                let u_im = im[a];
                let v_re = re[b] * w_re - im[b] * w_im;
                let v_im = re[b] * w_im + im[b] * w_re;
                re[a] = u_re + v_re;
                im[a] = u_im + v_im;
                re[b] = u_re - v_re;
                im[b] = u_im - v_im;
                // advance twiddle: w *= wlen
                let nw_re = w_re * wlen_re - w_im * wlen_im;
                let nw_im = w_re * wlen_im + w_im * wlen_re;
                w_re = nw_re;
                w_im = nw_im;
            }
            i += len;
        }
        len <<= 1;
    }
}
