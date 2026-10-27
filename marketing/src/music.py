"""
"Greenhouse" — original music for the Crystal ad. Synthesised from scratch in this file, so there is no
sample, loop or third-party recording in it: it is ours outright and free to use anywhere.

120 BPM, so one bar is exactly 2 seconds and every scene cut in the video lands on a beat.
Deep-house groove in A minor with jazzy 7th/9th chords:

  bars 0-1   (0-4s)    intro: filtered pad and hats, the filter opening up
  bars 2-9   (4-20s)   groove: four-on-the-floor kick, claps, bass, chord stabs; melody from bar 6
  bars 10-11 (20-24s)  breakdown: kick out, pad and a riser (the "privacy" moment)
  bars 12-13 (24-28s)  groove again
  bar 14     (28-30s)  final hit and reverb tail

Run:  python music.py out.wav   (needs numpy)
"""

import sys
import wave

import numpy as np

SR = 44100
BPM = 120
BEAT = 60 / BPM
BAR = BEAT * 4
LENGTH = 30.0
N = int(SR * LENGTH)
rng = np.random.default_rng(7)


def t_of(seconds: float) -> int:
    return int(round(seconds * SR))


def env_adsr(n, a=0.005, d=0.1, s=0.6, r=0.1, hold=None):
    """Simple ADSR, `hold` seconds of sustain before release (defaults to fill n)."""
    a_n, d_n, r_n = int(a * SR), int(d * SR), int(r * SR)
    total = n
    hold_n = total - a_n - d_n - r_n if hold is None else int(hold * SR)
    hold_n = max(hold_n, 0)
    e = np.concatenate([
        np.linspace(0, 1, max(a_n, 1), endpoint=False),
        np.linspace(1, s, max(d_n, 1), endpoint=False),
        np.full(hold_n, s),
        np.linspace(s, 0, max(r_n, 1)),
    ])
    if len(e) < total:
        e = np.concatenate([e, np.zeros(total - len(e))])
    return e[:total]


def lowpass(x, cutoff, q=0.7):
    """Zero-phase low-pass in the frequency domain, with a gentle resonant bump near the cutoff."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    ratio = f / max(cutoff, 1)
    mag = 1 / np.sqrt(1 + ratio ** 8)  # ~48 dB/oct
    mag *= 1 + (q - 0.7) * np.exp(-((ratio - 1) ** 2) / 0.02)
    return np.fft.irfft(X * mag, n=len(x))


def highpass(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    mag = 1 - 1 / np.sqrt(1 + (f / max(cutoff, 1)) ** 8)
    return np.fft.irfft(X * mag, n=len(x))


def bandpass(x, lo, hi):
    return highpass(lowpass(x, hi), lo)


def saw(freq, n, detune_cents=0.0, phase=0.0):
    """Band-limited sawtooth by additive synthesis (no aliasing)."""
    t = np.arange(n) / SR
    f = freq * 2 ** (detune_cents / 1200)
    out = np.zeros(n)
    k = 1
    while k * f < SR / 2.2 and k < 40:
        out += np.sin(2 * np.pi * k * f * t + phase * k) / k
        k += 1
    return out * 0.6


def note(name: str) -> float:
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    pitch, octave = name[:-1], int(name[-1])
    return 440 * 2 ** ((names[pitch] + 12 * (octave + 1) - 69) / 12)


# --- Buses (stereo) -------------------------------------------------------------------------------
drums = np.zeros((N, 2))
bass_bus = np.zeros(N)
chords = np.zeros((N, 2))
pad = np.zeros((N, 2))
lead = np.zeros((N, 2))
fx = np.zeros((N, 2))


def add(bus, start_s, sig, pan=0.0, gain=1.0):
    i = t_of(start_s)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    if bus.ndim == 1:
        bus[i : i + len(sig)] += sig
    else:
        l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
        if sig.ndim == 1:
            bus[i : i + len(sig), 0] += sig * l * 1.414
            bus[i : i + len(sig), 1] += sig * r * 1.414
        else:
            bus[i : i + len(sig)] += sig


# --- Sections -------------------------------------------------------------------------------------
def in_groove(bar):
    return 2 <= bar <= 9 or 12 <= bar <= 13


def in_breakdown(bar):
    return 10 <= bar <= 11


# --- Drums ----------------------------------------------------------------------------------------
def kick():
    n = t_of(0.45)
    t = np.arange(n) / SR
    freq = 46 + 110 * np.exp(-t * 32)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    body = np.sin(phase) * np.exp(-t * 7.5)
    click = lowpass(rng.standard_normal(n) * np.exp(-t * 400), 4000) * 0.25
    return np.tanh((body + click) * 1.6) * 0.95


def clap():
    n = t_of(0.35)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    e = np.zeros(n)
    for off in (0.0, 0.011, 0.022):
        o = t_of(off)
        e[o:] += np.exp(-(t[: n - o]) * 60)
    e += np.exp(-t * 14) * 0.5
    return bandpass(noise * e, 900, 5000) * 0.5


def hat(open_=False):
    n = t_of(0.3 if open_ else 0.06)
    t = np.arange(n) / SR
    sig = highpass(rng.standard_normal(n), 7500) * np.exp(-t * (12 if open_ else 70))
    return sig * (0.22 if open_ else 0.18)


def shaker():
    n = t_of(0.05)
    t = np.arange(n) / SR
    return bandpass(rng.standard_normal(n), 5000, 11000) * np.exp(-t * 90) * 0.08


K, C = kick(), clap()
for bar in range(15):
    t0 = bar * BAR
    if bar == 14:
        add(drums, t0, K, gain=1.0)
        add(drums, t0, C, gain=0.8)
        continue
    for beat in range(4):
        tb = t0 + beat * BEAT
        if in_groove(bar):
            add(drums, tb, K)
            if beat in (1, 3):
                add(drums, tb, C, pan=0.0)
        # Hats from the start: closed on 16ths with swing, open on the off-beat.
        if in_groove(bar) or bar in (0, 1) or in_breakdown(bar):
            add(drums, tb + BEAT / 2, hat(open_=in_groove(bar)), pan=0.25, gain=1.0 if in_groove(bar) else 0.6)
            if in_groove(bar):
                for s16 in (1, 3):
                    swing = 0.018 if s16 == 3 else 0.0
                    add(drums, tb + s16 * BEAT / 4 + swing, hat(), pan=-0.3, gain=0.7)
                add(drums, tb + BEAT * 0.75, shaker(), pan=0.5)
# A little fill into the drop and into the second groove.
for t_fill in (4 * BAR - BEAT, 12 * BAR - BEAT):
    for i in range(4):
        add(drums, t_fill + i * BEAT / 4, C, gain=0.35 + i * 0.12, pan=(-0.3 + i * 0.2))

# --- Harmony --------------------------------------------------------------------------------------
# Fmaj9 – G6/9 – Am9 – Em7(11), one bar each.
PROGRESSION = [
    ["F3", "A3", "C4", "E4", "G4"],
    ["G3", "B3", "D4", "E4", "A4"],
    ["A3", "C4", "E4", "G4", "B4"],
    ["E3", "G3", "B3", "D4", "A4"],
]
ROOTS = ["F1", "G1", "A1", "E1"]


def chord_stab(names, dur, cutoff):
    n = t_of(dur)
    left = sum(saw(note(x), n, detune_cents=-7) for x in names)
    right = sum(saw(note(x), n, detune_cents=+7, phase=0.5) for x in names)
    e = env_adsr(n, a=0.004, d=0.12, s=0.35, r=0.06)
    l = lowpass(left * e, cutoff, q=1.1)
    r = lowpass(right * e, cutoff, q=1.1)
    return np.stack([l, r], axis=1) * 0.09


def pad_chord(names, dur, cutoff):
    n = t_of(dur)
    left = sum(saw(note(x), n, detune_cents=-11) for x in names)
    right = sum(saw(note(x), n, detune_cents=+11, phase=1.1) for x in names)
    e = env_adsr(n, a=0.5, d=0.3, s=0.8, r=0.6)
    return np.stack([lowpass(left * e, cutoff), lowpass(right * e, cutoff)], axis=1) * 0.06


# Deep-house stab rhythm, in beats within a bar.
STABS = [0.0, 0.75, 1.5, 2.5, 3.25]
for bar in range(15):
    chord = PROGRESSION[bar % 4]
    t0 = bar * BAR
    if bar in (0, 1):
        # Intro pad with the filter opening across both bars.
        add(pad, t0, pad_chord(chord, BAR + 0.4, 500 + bar * 900))
    elif in_groove(bar):
        for i, b in enumerate(STABS):
            cutoff = 2400 if bar >= 6 else 1700
            add(chords, t0 + b * BEAT, chord_stab(chord, 0.32 if i else 0.4, cutoff + (i % 2) * 300))
        add(pad, t0, pad_chord(chord, BAR + 0.3, 900), gain=0.5)
    elif in_breakdown(bar):
        add(pad, t0, pad_chord(chord, BAR + 0.5, 1400 + (bar - 10) * 1200), gain=1.2)
    elif bar == 14:
        # The final hit: the home chord, held, ringing into the reverb.
        add(chords, t0, chord_stab(["A3", "C4", "E4", "G4", "B4", "E5"], 1.6, 3200), gain=1.4)
        add(pad, t0, pad_chord(PROGRESSION[2], 2.0, 1800), gain=1.0)

# --- Bass -----------------------------------------------------------------------------------------
def bass_note(freq, dur):
    n = t_of(dur)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(2 * np.pi * 2 * freq * t) + 0.12 * saw(freq * 2, n)
    e = env_adsr(n, a=0.004, d=0.08, s=0.7, r=0.04)
    return lowpass(np.tanh(sig * 1.3) * e, 700) * 0.34


BASS_PATTERN = [(0.5, 0.4), (1.25, 0.2), (1.5, 0.4), (2.5, 0.4), (3.0, 0.2), (3.5, 0.4)]  # off-beat house bass
for bar in range(14):
    if not in_groove(bar):
        continue
    root = note(ROOTS[bar % 4]) * 2
    for i, (b, d) in enumerate(BASS_PATTERN):
        f = root * (2 if i == 4 else 1)  # an octave jump for bounce
        add(bass_bus, bar * BAR + b * BEAT, bass_note(f, d))
add(bass_bus, 14 * BAR, bass_note(note("A1") * 2, 1.2), gain=1.1)

# --- Lead pluck (from bar 6) ----------------------------------------------------------------------
def pluck(freq, dur=0.35):
    n = t_of(dur)
    t = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 3 * freq * t) * np.exp(-t * 30)
    return sig * np.exp(-t * 9) * 0.16


# A small A-minor-pentatonic hook, two bars long: (beat, note).
HOOK = [(0, "E5"), (0.75, "G5"), (1.5, "A5"), (2.5, "C6"), (3.0, "A5"), (4.0, "G5"), (4.75, "E5"), (5.5, "D5"), (6.5, "E5")]
for start_bar in (6, 8, 12):
    for b, nm in HOOK:
        add(lead, start_bar * BAR + b * BEAT, pluck(note(nm)), pan=-0.2)
        add(lead, start_bar * BAR + b * BEAT + BEAT * 0.75, pluck(note(nm), 0.25) * 0.35, pan=0.45)  # dotted-8th echo

# --- FX -------------------------------------------------------------------------------------------
# Riser over the breakdown, into bar 12.
n = t_of(2 * BAR)
t = np.arange(n) / SR
noise = rng.standard_normal(n)
riser = np.zeros(n)
for i in range(0, n, 2048):
    seg = noise[i : i + 2048]
    riser[i : i + len(seg)] = bandpass(seg, 800 + 6000 * (i / n), 2000 + 9000 * (i / n))
riser *= (t / t[-1]) ** 2 * 0.25
add(fx, 10 * BAR, riser, pan=0.0)
# Reverse-cymbal swell into the drop.
n = t_of(BAR)
t = np.arange(n) / SR
swell = highpass(rng.standard_normal(n), 5000) * (t / t[-1]) ** 3 * 0.2
add(fx, 1 * BAR, swell)

# --- Mix ------------------------------------------------------------------------------------------
# Sidechain: everything except drums ducks under each kick.
duck = np.ones(N)
for bar in range(15):
    for beat in range(4):
        if in_groove(bar) or (bar == 14 and beat == 0):
            i = t_of(bar * BAR + beat * BEAT)
            m = t_of(0.28)
            curve = 1 - 0.65 * np.exp(-np.arange(m) / SR * 14)
            j = min(N, i + m)
            duck[i:j] = np.minimum(duck[i:j], curve[: j - i])


def reverb(x, seconds=1.6, mix=0.25):
    """Convolution reverb with a decaying noise impulse, per channel, via FFT."""
    n_ir = t_of(seconds)
    t = np.arange(n_ir) / SR
    out = np.zeros_like(x)
    for ch in range(2):
        ir = lowpass(rng.standard_normal(n_ir), 6000) * np.exp(-t * 4.0)
        ir /= np.sqrt(np.sum(ir ** 2))
        size = len(x) + n_ir
        wet = np.fft.irfft(np.fft.rfft(x[:, ch], size) * np.fft.rfft(ir, size), size)[: len(x)]
        out[:, ch] = x[:, ch] * (1 - mix) + wet * mix
    return out


bass_st = np.stack([bass_bus, bass_bus], axis=1)
music = (
    drums * 0.9
    + bass_st * duck[:, None]
    + reverb(chords, 1.4, 0.28) * duck[:, None]
    + reverb(pad, 2.4, 0.4) * duck[:, None]
    + reverb(lead, 1.8, 0.35)
    + reverb(fx, 2.0, 0.3)
)
# Fade the tail and master: gentle glue, soft clip, peak at -1 dBFS.
fade = np.ones(N)
fade[t_of(29.2) :] = np.linspace(1, 0, N - t_of(29.2))
music *= fade[:, None]
music = np.tanh(music * 1.05) / np.tanh(1.05)
music *= 10 ** (-1 / 20) / np.max(np.abs(music))

out = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((music * 32767).astype("<i2").tobytes())
print("wrote", out, f"{LENGTH:.0f}s")
