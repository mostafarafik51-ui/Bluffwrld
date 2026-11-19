# Original soundtrack for the "where did you get that?" film, synthesised from scratch.
#   python3 ad/music.py <out.wav>
# 21 s at 128 BPM, timed to the cuts: tension under the conversation, a riser on the point,
# a hit on the store reveal, a hard drop for the rush, near-silence when she is left alone,
# one last hit on the logo.
import sys, wave
import numpy as np

SR = 44100
DUR = 21.0
BPM = 128.0
BEAT = 60.0 / BPM
N = int(SR * DUR)
t_all = np.arange(N) / SR
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(7)

def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N: return
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * (1 - max(0, pan))
    R[i:i + len(sig)] += sig * gain * (1 + min(0, pan))

def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)

def kick(punch=1.0):
    n = int(0.45 * SR); t = np.arange(n) / SR
    f = 45 + 120 * np.exp(-t / 0.04)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(2.2 * punch * np.sin(ph) * np.exp(-t / 0.16))

def snare():
    n = int(0.3 * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n) * np.exp(-t / 0.07)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.05)
    return 0.55 * noise + 0.5 * body

def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    x = rng.standard_normal(n)
    x = np.diff(np.concatenate([[0], x]))          # brighter
    return 0.35 * x * env(n, 0.0005, 0.06 if open_ else 0.012)

def bass(freq, length, drive=3.0):
    n = int(length * SR); t = np.arange(n) / SR
    saw = 2 * ((freq * t) % 1) - 1
    sub = np.sin(2 * np.pi * freq / 2 * t)
    return np.tanh(drive * (0.6 * saw + 0.6 * sub)) * env(n, 0.004, length * 0.6)

def pad(freqs, length, bright=0.3):
    n = int(length * SR); t = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * t + np.sin(2 * np.pi * 0.2 * t) * 0.6) + bright * np.sin(2 * np.pi * 2 * f * t) for f in freqs)
    a = np.minimum(1, t / 0.8) * np.minimum(1, (length - t) / 0.8)
    return x * a / len(freqs)

def boom(length=2.5):
    n = int(length * SR); t = np.arange(n) / SR
    f = 32 + 60 * np.exp(-t / 0.12)
    ph = 2 * np.pi * np.cumsum(f) / SR
    low = np.sin(ph) * np.exp(-t / 0.9)
    crash = rng.standard_normal(n) * np.exp(-t / 0.5) * 0.25
    return np.tanh(1.8 * (low + crash))

def riser(length):
    n = int(length * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # crude rising band: blend from lowpassed to raw noise, plus a rising tone
    k = np.clip(t / length, 0, 1)
    lp = np.convolve(noise, np.ones(40) / 40, mode="same")
    tone = np.sin(2 * np.pi * np.cumsum(120 + 900 * k ** 2) / SR)
    return (lp * (1 - k) + noise * k * 0.5 + 0.35 * tone) * k ** 1.6

def beat_times(t0, t1, step):
    out, x = [], t0
    while x < t1 - 1e-6:
        out.append(x); x += step
    return out

S16 = BEAT / 4
# ---- 0.0 - 6.8: tension under the conversation -------------------------------------------
for i, b in enumerate(beat_times(0.0, 6.8, BEAT)):
    add(kick(0.6), b, 0.35)
    add(hat(), b + BEAT / 2, 0.35, -0.3)
for b in beat_times(0.0, 6.8, BEAT * 2):
    add(bass(41.2, BEAT * 1.8, 1.5), b, 0.28)                 # low E pulse
add(pad([82.4, 98.0, 123.5], 6.9, 0.2), 0.0, 0.22)            # Em, dark
# ---- 6.8 - 8.8: the point, a riser -----------------------------------------------------------
add(riser(2.0), 6.8, 0.5)
for b in beat_times(7.75, 8.8, S16):
    add(snare(), b, 0.15 + 0.5 * (b - 7.75))                   # snare roll into the reveal
# ---- 8.8 - 12.4: the store, a hit and a wide pad -------------------------------------------
add(boom(3.0), 8.8, 0.9)
add(pad([65.4, 98.0, 130.8, 164.8, 196.0], 3.7, 0.5), 8.8, 0.32)   # C major spread
for b in beat_times(8.8, 12.4, BEAT * 2):
    add(kick(0.8), b, 0.45)
add(riser(1.2), 11.2, 0.45)
# ---- 12.4 - 15.8: the rush, everything at once ---------------------------------------------
add(boom(1.4), 12.4, 0.7)
notes = [41.2, 41.2, 49.0, 41.2, 55.0, 41.2, 49.0, 61.7]
for i, b in enumerate(beat_times(12.4, 15.8, S16)):
    add(hat(i % 8 == 6), b, 0.4 if i % 2 else 0.25, 0.25 if i % 2 else -0.25)
    if i % 2 == 0:
        add(bass(notes[(i // 2) % len(notes)], S16 * 1.8, 4.0), b, 0.33)
for i, b in enumerate(beat_times(12.4, 15.8, BEAT)):
    add(kick(1.0), b, 0.75)
    if i % 2 == 1: add(snare(), b, 0.55)
# ---- 15.8 - 18.4: she is left alone: everything drops away -----------------------------------
add(pad([82.4, 123.5, 164.8], 2.7, 0.1), 15.8, 0.18)
add(hat(True), 15.8, 0.3)
# ---- 18.4: the logo ---------------------------------------------------------------------
add(boom(2.6), 18.45, 1.0)

mix = np.stack([L, R], axis=1)
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(1.3 * mix) / np.tanh(1.3)                        # glue
fade = np.minimum(1, (DUR - t_all) / 0.6)[:, None]
mix *= fade * 0.95
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", sys.argv[1])
