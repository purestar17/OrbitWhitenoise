"""Generate the placeholder built-in sounds with numpy + ffmpeg.

These are synthesized stand-ins so the app works out of the box.
Replace any of them with real recordings through the admin page
(admin.html) or by overwriting the mp3 in /sounds with the same name.

Usage:  python3 tools/generate_sounds.py
"""
import os
import subprocess
import tempfile
import wave

import numpy as np

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), "..", "sounds")
rng = np.random.default_rng(7)


def white(n):
    return rng.standard_normal(n)


def pink(n):
    # Voss-McCartney style via FFT shaping (1/f power)
    x = rng.standard_normal(n)
    f = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    freqs[0] = freqs[1]
    f /= np.sqrt(freqs)
    return np.fft.irfft(f, n)


def brown(n):
    x = np.cumsum(rng.standard_normal(n))
    x -= np.convolve(x, np.ones(SR) / SR, mode="same")  # remove drift
    return x


def fft_filter(x, lo=None, hi=None):
    f = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / SR)
    mask = np.ones_like(freqs)
    if lo:
        mask *= 1 / (1 + (lo / np.maximum(freqs, 1)) ** 4)
    if hi:
        mask *= 1 / (1 + (freqs / hi) ** 4)
    return np.fft.irfft(f * mask, len(x))


def slow_lfo(n, period_s, depth, phase=0.0):
    t = np.arange(n) / SR
    return 1 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * t / period_s + phase))


def smooth_random(n, step_s, lo, hi):
    pts = rng.uniform(lo, hi, int(n / (step_s * SR)) + 3)
    xs = np.linspace(0, n, len(pts))
    return np.interp(np.arange(n), xs, pts)


def norm(x, peak=0.8):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def make_loop(x, xfade_s=2.0):
    """Crossfade tail into head so the clip loops without a seam."""
    k = int(xfade_s * SR)
    head, tail = x[:k], x[-k:]
    w = np.linspace(0, 1, k)
    mixed = tail * (1 - w) + head * w
    return np.concatenate([mixed, x[k:-k]])


def drops(n, rate_hz, dur_s, freq_lo, freq_hi, amp_lo=0.2, amp_hi=1.0):
    out = np.zeros(n)
    count = int(n / SR * rate_hz)
    m = int(dur_s * SR)
    t = np.arange(m) / SR
    for _ in range(count):
        p = rng.integers(0, n - m)
        f = rng.uniform(freq_lo, freq_hi)
        env = np.exp(-t / (dur_s / 5))
        out[p:p + m] += rng.uniform(amp_lo, amp_hi) * env * np.sin(2 * np.pi * f * t * (1 + 0.3 * t / dur_s))
    return out


def crackles(n, rate_hz, amp=1.0):
    out = np.zeros(n)
    for _ in range(int(n / SR * rate_hz)):
        p = rng.integers(0, n - 2000)
        m = rng.integers(80, 900)
        out[p:p + m] += amp * rng.uniform(0.2, 1) * rng.standard_normal(m) * np.exp(-np.arange(m) / (m / 4))
    return fft_filter(out, lo=800)


def chirp(dur, f0, f1, vib=0.0):
    t = np.arange(int(dur * SR)) / SR
    f = f0 + (f1 - f0) * (t / dur) + vib * np.sin(2 * np.pi * 28 * t)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.sin(np.pi * t / dur) ** 2
    return env * np.sin(ph)


def silence(s):
    return np.zeros(int(s * SR))


def write_mp3(name, x, loop):
    x = norm(x, 0.85 if not loop else 0.7)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        path = os.path.join(OUT, name + ".mp3")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name,
                        "-codec:a", "libmp3lame", "-b:a", "96k", path], check=True)
    os.unlink(tmp.name)
    print("wrote", path)


def loop_sound(seconds=24):
    return int((seconds + 2) * SR)


def build():
    os.makedirs(OUT, exist_ok=True)
    L = loop_sound()

    # --- rain ---
    base = fft_filter(pink(L), lo=400, hi=9000) * smooth_random(L, 1.5, 0.75, 1.0)
    write_mp3("rain-grass", make_loop(base + 0.25 * drops(L, 18, 0.03, 2500, 6000)), True)

    tent = fft_filter(pink(L), lo=150, hi=3500) * 0.6 + 0.9 * fft_filter(drops(L, 40, 0.05, 300, 900), hi=2500)
    write_mp3("rain-tent", make_loop(tent), True)

    heavy = fft_filter(white(L), lo=200, hi=7000) * smooth_random(L, 0.8, 0.6, 1.0) + 0.5 * fft_filter(brown(L), hi=300)
    write_mp3("rain-heavy", make_loop(heavy), True)

    # --- water ---
    stream = fft_filter(white(L), lo=600, hi=5000) * smooth_random(L, 0.25, 0.5, 1.0) + 0.3 * drops(L, 25, 0.04, 800, 2200)
    write_mp3("stream", make_loop(stream), True)

    period = 26 / 3  # three swells per loop so it stays seamless
    waves = fft_filter(pink(L), hi=2500) * slow_lfo(L, period, 0.85) ** 2 + 0.15 * fft_filter(brown(L), hi=200)
    write_mp3("waves", make_loop(waves), True)

    # --- nature ---
    wind = fft_filter(brown(L), lo=60, hi=900) * smooth_random(L, 3, 0.3, 1.0)
    write_mp3("wind", make_loop(wind), True)

    crk = np.zeros(L)
    t = np.arange(int(0.05 * SR)) / SR
    for start in np.arange(0, L - SR, int(SR * 0.42)):
        if rng.random() < 0.85:
            m = len(t)
            crk[start:start + m] += np.sin(2 * np.pi * 4300 * t) * (np.sin(2 * np.pi * 60 * t) > 0) * np.exp(-t / 0.02)
    crickets = crk * 0.6 + 0.05 * fft_filter(pink(L), hi=3000)
    write_mp3("crickets", make_loop(crickets), True)

    # --- fire ---
    fire = 0.6 * fft_filter(brown(L), hi=500) * smooth_random(L, 0.6, 0.6, 1.0) + crackles(L, 6, 1.2)
    write_mp3("campfire", make_loop(fire), True)

    # --- city / home ---
    tick = np.zeros(L)
    t = np.arange(int(0.02 * SR)) / SR
    click = np.exp(-t / 0.003) * fft_filter(rng.standard_normal(len(t)), lo=1500)
    for i, start in enumerate(range(0, L - len(t), SR // 2)):
        tick[start:start + len(t)] += click * (1.0 if i % 2 == 0 else 0.7)
    write_mp3("clock", make_loop(tick, 0.01), True)

    cafe = 0.5 * fft_filter(pink(L), lo=200, hi=3000) * smooth_random(L, 0.4, 0.5, 1.0) + 0.3 * drops(L, 3, 0.15, 2000, 3500, 0.1, 0.4)
    write_mp3("cafe", make_loop(cafe), True)

    # --- noise colours ---
    write_mp3("noise-white", make_loop(white(L)), True)
    write_mp3("noise-pink", make_loop(pink(L)), True)
    write_mp3("noise-brown", make_loop(fft_filter(brown(L), lo=20)), True)

    # --- one-shots (effects) ---
    n = int(7 * SR)
    th = fft_filter(brown(n), hi=250) * np.exp(-np.arange(n) / (2.2 * SR))
    th[: int(0.4 * SR)] *= np.linspace(0, 1, int(0.4 * SR))
    write_mp3("thunder", th + 0.3 * fft_filter(white(n), lo=800, hi=3000) * np.exp(-np.arange(n) / (0.4 * SR)), False)

    bird = np.concatenate([chirp(0.12, 3200, 4800), silence(0.06), chirp(0.12, 3400, 5200), silence(0.08),
                           chirp(0.35, 5200, 2600, vib=300), silence(0.4), chirp(0.1, 4000, 5000), silence(0.05), chirp(0.25, 4800, 3000, vib=200)])
    write_mp3("birds", bird, False)

    owl = np.concatenate([chirp(0.45, 390, 360) * 0.9, silence(0.25), chirp(0.25, 380, 370), silence(0.12), chirp(0.6, 400, 340)])
    write_mp3("owl", fft_filter(owl + 0.02 * white(len(owl)), hi=1500), False)

    n = int(1.2 * SR)
    t = np.arange(n) / SR
    drip = np.sin(2 * np.pi * (900 + 1400 * np.exp(-t / 0.02)) * t) * np.exp(-t / 0.08)
    write_mp3("drip", drip, False)

    write_mp3("crackle", crackles(int(1.5 * SR), 8, 1.0) + 0.0, False)

    n = int(4.5 * SR)
    t = np.arange(n) / SR
    chime = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / d) * a
                for f, d, a in [(1318, 1.6, 1), (1760, 1.2, 0.6), (2637, 0.7, 0.35), (3520, 0.4, 0.2)])
    write_mp3("chime", chime, False)


if __name__ == "__main__":
    build()
