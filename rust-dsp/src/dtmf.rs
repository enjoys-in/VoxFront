//! DTMF (touch-tone) detection using the Goertzel algorithm.
//!
//! Eight Goertzel filters (4 low + 4 high tones) run over ~25 ms blocks.
//! A valid digit needs one dominant low and one dominant high tone, both well
//! above the residual energy and within a sane "twist" ratio. Detection is
//! edge-triggered so a held key reports once.

use crate::HOP;
use libm::cosf;
use core::f32::consts::PI;

const LOW: [f32; 4] = [697.0, 770.0, 852.0, 941.0];
const HIGH: [f32; 4] = [1209.0, 1336.0, 1477.0, 1633.0];
const MAX_N: usize = 2048;

pub struct Dtmf {
    buf: [f32; MAX_N],
    count: usize,
    n: usize,
    coeff_low: [f32; 4],
    coeff_high: [f32; 4],
    last_key: i32,
    stable: i32,
}

impl Dtmf {
    pub const fn new() -> Self {
        Dtmf {
            buf: [0.0; MAX_N],
            count: 0,
            n: 512,
            coeff_low: [0.0; 4],
            coeff_high: [0.0; 4],
            last_key: -1,
            stable: -1,
        }
    }

    pub fn init(&mut self, sample_rate: f32) {
        // ~25 ms analysis window, clamped to our buffer.
        let mut n = (sample_rate * 0.025) as usize;
        if n > MAX_N {
            n = MAX_N;
        }
        if n < 128 {
            n = 128;
        }
        self.n = n;
        for i in 0..4 {
            self.coeff_low[i] = 2.0 * cosf(2.0 * PI * LOW[i] / sample_rate);
            self.coeff_high[i] = 2.0 * cosf(2.0 * PI * HIGH[i] / sample_rate);
        }
        self.count = 0;
        self.last_key = -1;
        self.stable = -1;
    }

    fn goertzel(buf: &[f32], coeff: f32) -> f32 {
        let mut s_prev = 0.0f32;
        let mut s_prev2 = 0.0f32;
        for &x in buf {
            let s = x + coeff * s_prev - s_prev2;
            s_prev2 = s_prev;
            s_prev = s;
        }
        s_prev2 * s_prev2 + s_prev * s_prev - coeff * s_prev * s_prev2
    }

    /// Feed one hop. Returns a key index 0..15 on a newly detected digit, else -1.
    pub fn process(&mut self, block: &[f32; HOP]) -> i32 {
        for i in 0..HOP {
            if self.count < MAX_N {
                self.buf[self.count] = block[i];
                self.count += 1;
            }
        }
        if self.count < self.n {
            return -1;
        }

        let window = &self.buf[..self.n];
        let mut total = 1e-6f32;
        for &x in window {
            total += x * x;
        }

        let mut low_pow = [0.0f32; 4];
        let mut high_pow = [0.0f32; 4];
        for i in 0..4 {
            low_pow[i] = Self::goertzel(window, self.coeff_low[i]);
            high_pow[i] = Self::goertzel(window, self.coeff_high[i]);
        }
        // Reset the accumulator for the next block.
        self.count = 0;

        let (lo_idx, lo_val) = arg_max(&low_pow);
        let (hi_idx, hi_val) = arg_max(&high_pow);

        // Energy in the two winning tones should dominate the block.
        let tone_energy = lo_val + hi_val;
        let dominant = tone_energy > 0.35 * total;
        // Twist: the two tones should be within ~8 dB (~6.3x) of each other.
        let twist_ok = lo_val < hi_val * 8.0 && hi_val < lo_val * 8.0;
        // Absolute floor so silence/noise never triggers.
        let loud = tone_energy > 1e-3 * (self.n as f32);

        let mut key = -1i32;
        if dominant && twist_ok && loud {
            key = (lo_idx * 4 + hi_idx) as i32;
        }

        // Edge-trigger: report only on a new, repeated-stable key.
        let mut emitted = -1i32;
        if key >= 0 && key == self.stable && key != self.last_key {
            emitted = key;
            self.last_key = key;
        }
        if key != self.stable {
            self.stable = key;
        }
        if key < 0 {
            self.last_key = -1;
        }
        emitted
    }
}

fn arg_max(v: &[f32; 4]) -> (usize, f32) {
    let mut idx = 0;
    let mut max = v[0];
    for i in 1..4 {
        if v[i] > max {
            max = v[i];
            idx = i;
        }
    }
    (idx, max)
}
