//! Audio effects: a configurable biquad (used as a band-shaping / rumble
//! high-pass) and a feedback delay line for an echo effect.

use crate::HOP;
use libm::{cosf, sinf};
use core::f32::consts::PI;

const DELAY_MAX: usize = 24000; // 0.5 s at 48 kHz

#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    const fn identity() -> Self {
        Biquad { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 }
    }

    fn high_pass(&mut self, fc: f32, q: f32, fs: f32) {
        let w0 = 2.0 * PI * fc / fs;
        let cw = cosf(w0);
        let sw = sinf(w0);
        let alpha = sw / (2.0 * q);
        let a0 = 1.0 + alpha;
        self.b0 = (1.0 + cw) / 2.0 / a0;
        self.b1 = -(1.0 + cw) / a0;
        self.b2 = (1.0 + cw) / 2.0 / a0;
        self.a1 = (-2.0 * cw) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    #[inline]
    fn run(&mut self, x: f32) -> f32 {
        // Transposed direct form II.
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

pub struct Effects {
    hp: Biquad,
    delay: [f32; DELAY_MAX],
    widx: usize,
}

impl Effects {
    pub const fn new() -> Self {
        Effects {
            hp: Biquad::identity(),
            delay: [0.0; DELAY_MAX],
            widx: 0,
        }
    }

    pub fn init(&mut self, fs: f32) {
        // 90 Hz high-pass removes mains hum / handling rumble.
        self.hp.high_pass(90.0, 0.707, fs);
    }

    /// Apply enabled effects in place.
    /// - `hp_enabled`: rumble high-pass.
    /// - echo: `delay_samples`, `feedback` (0..0.9), `mix` (0..1).
    pub fn process(
        &mut self,
        block: &mut [f32; HOP],
        hp_enabled: bool,
        echo_enabled: bool,
        delay_samples: usize,
        feedback: f32,
        mix: f32,
    ) {
        let d = delay_samples.min(DELAY_MAX - 1).max(1);
        for s in block.iter_mut() {
            let mut x = *s;
            if hp_enabled {
                x = self.hp.run(x);
            }
            if echo_enabled {
                let ridx = (self.widx + DELAY_MAX - d) % DELAY_MAX;
                let echoed = self.delay[ridx];
                let out = x + mix * echoed;
                self.delay[self.widx] = x + feedback * echoed;
                self.widx = (self.widx + 1) % DELAY_MAX;
                x = out;
            }
            *s = x;
        }
    }
}
