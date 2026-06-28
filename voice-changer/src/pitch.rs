//! Granular (two-tap crossfading delay-line) pitch shifter.
//!
//! A classic real-time pitch shifter: input is written to a ring buffer while
//! two read pointers, kept half a window apart, drift through the buffer at a
//! rate set by the pitch `ratio`. A Hann crossfade between the two taps masks
//! the discontinuity each time a pointer wraps, so the output pitch changes
//! without changing the stream's duration. Pitch and timbre move together
//! (the familiar "chipmunk / deep voice" character), which is exactly what the
//! fun voice presets want.

use core::f32::consts::PI;
use libm::cosf;

/// Ring-buffer length (power of two, comfortably larger than `WINDOW`).
const BUF: usize = 4096;
/// Crossfade window length in samples (~21 ms at 48 kHz).
const WINDOW: f32 = 1024.0;

pub struct Pitch {
    buf: [f32; BUF],
    write: usize,
    phase: f32, // read-pointer offset in [0, WINDOW)
}

impl Pitch {
    pub const fn new() -> Self {
        Pitch {
            buf: [0.0; BUF],
            write: 0,
            phase: 0.0,
        }
    }

    /// Linearly interpolated read `delay` samples behind the write pointer.
    #[inline]
    fn read_frac(&self, delay: f32) -> f32 {
        let mut p = self.write as f32 - delay;
        while p < 0.0 {
            p += BUF as f32;
        }
        while p >= BUF as f32 {
            p -= BUF as f32;
        }
        let i0 = p as usize;
        let frac = p - i0 as f32;
        let i1 = if i0 + 1 >= BUF { 0 } else { i0 + 1 };
        self.buf[i0] * (1.0 - frac) + self.buf[i1] * frac
    }

    /// Pitch-shift `block` in place by `ratio` (= 2^(semitones/12)).
    pub fn process(&mut self, block: &mut [f32], ratio: f32) {
        let half = WINDOW * 0.5;
        // Read pointer drifts by (1 - ratio) per sample: ratio<1 grows the
        // delay (pitch down), ratio>1 shrinks it (pitch up).
        let delta = 1.0 - ratio;
        for s in block.iter_mut() {
            self.buf[self.write] = *s;

            let r0 = self.phase;
            let mut r1 = self.phase + half;
            if r1 >= WINDOW {
                r1 -= WINDOW;
            }

            let s0 = self.read_frac(r0);
            let s1 = self.read_frac(r1);

            // Hann envelopes for the two taps sum to 1 at a half-window offset
            // (constant-overlap-add), so this is a unity-gain crossfade.
            let w0 = 0.5 - 0.5 * cosf(2.0 * PI * r0 / WINDOW);
            let w1 = 0.5 - 0.5 * cosf(2.0 * PI * r1 / WINDOW);

            *s = w0 * s0 + w1 * s1;

            self.phase += delta;
            while self.phase >= WINDOW {
                self.phase -= WINDOW;
            }
            while self.phase < 0.0 {
                self.phase += WINDOW;
            }

            self.write += 1;
            if self.write >= BUF {
                self.write = 0;
            }
        }
    }
}
