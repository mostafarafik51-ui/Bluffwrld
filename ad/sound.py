# Full soundtrack for the store film: music, sound effects and the characters' voices.
#   python3 ad/sound.py <out.wav>
# Everything is synthesised here except the voices (ad/audio/*.wav, made by ad/voices.py).
# Who speaks when comes from ad/dialogue.json. The script also writes ad/audio/lipsync.json,
# the loudness of every line frame by frame, which moves the characters' mouths.
#
#  0.0   street: city ambience, a cool minimal beat (muted plucks, soft 808), her footsteps
#  4.0   "Wait."            tape stop: the beat winds down and dies
#  5.1   "Where did you get that?"   in near-silence, just the street
#  6.8   she points: a heartbeat kick and a riser, "No way."
#  8.8   the store: a huge cinematic braaam, a whoosh with the crane, a choir pad
# 10.6   inside: a door chime, the murmur of people realising, hats rolling faster
# 12.4   THE RUSH: a hard trap drop, sliding 808s, rolling hats, a stampede, shouts
# 15.8   vinyl stop: ambience, distant crowd noise from the store, her alone
# 18.0   reverse swell into a final braaam on the logo
import sys, os, wave
import numpy as np

SR = 44100
DUR = 21.0
BPM = 140.0
BEAT = 60.0 / BPM
N = int(SR * DUR)
L = np.zeros(N); R = np.zeros(N)
rng = np.random.default_rng(11)
HERE = os.path.dirname(os.path.abspath(__file__))

# ---- helpers ---------------------------------------------------------------------------
def add(sig, at, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N or i + len(sig) <= 0: return
    if i < 0: sig = sig[-i:]; i = 0
    sig = sig[: N - i]
    L[i:i + len(sig)] += sig * gain * min(1, 1 - pan)
    R[i:i + len(sig)] += sig * gain * min(1, 1 + pan)

def tt(n): return np.arange(n) / SR
def env(n, a=0.002, d=0.2):
    t = tt(n); return np.minimum(1, t / a) * np.exp(-t / d)
def lowpass(x, k):
    k = max(1, int(k)); return np.convolve(x, np.ones(k) / k, mode="same")
def highpass(x, k): return x - lowpass(x, k)
def noise(sec): return rng.standard_normal(int(sec * SR))

def load_voice(name):
    with wave.open(os.path.join(HERE, "audio", name + ".wav")) as w:
        sr = w.getframerate(); x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(float) / 32768
    # resample to 44.1 kHz
    t_new = np.arange(int(len(x) * SR / sr)) / SR
    return np.interp(t_new, np.arange(len(x)) / sr, x)

def kick(punch=1.0):
    n = int(0.45 * SR); t = tt(n)
    f = 45 + 110 * np.exp(-t / 0.035)
    return np.tanh(2.2 * punch * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16))
def snare(bright=1.0):
    n = int(0.28 * SR); t = tt(n)
    return 0.6 * highpass(rng.standard_normal(n), 3 if bright > 0.5 else 8) * np.exp(-t / 0.07) + 0.45 * np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.05)
def clap():
    n = int(0.25 * SR); t = tt(n); x = highpass(rng.standard_normal(n), 4)
    e = sum(np.exp(-np.maximum(0, t - d) / 0.012) * (t >= d) for d in (0, 0.01, 0.022)) + np.exp(-t / 0.09) * 0.6
    return 0.5 * x * e
def hat(open_=False):
    n = int((0.2 if open_ else 0.05) * SR)
    return 0.32 * highpass(rng.standard_normal(n), 2) * env(n, 0.0005, 0.07 if open_ else 0.012)
def bass(freq, length, drive=3.0):
    n = int(length * SR); t = tt(n)
    saw = 2 * ((freq * t) % 1) - 1
    return np.tanh(drive * (0.55 * saw + 0.7 * np.sin(2 * np.pi * freq / 2 * t))) * env(n, 0.004, length * 0.6)
def keys(freqs, length):
    n = int(length * SR); t = tt(n)
    x = sum(np.sin(2 * np.pi * f * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4.5 * t)) for f in freqs) / len(freqs)
    return x * env(n, 0.01, length * 0.45)
def pad(freqs, length, bright=0.3):
    n = int(length * SR); t = tt(n)
    x = sum(np.sin(2 * np.pi * f * t + 0.6 * np.sin(2 * np.pi * 0.25 * t)) + bright * np.sin(2 * np.pi * 2.003 * f * t) for f in freqs) / len(freqs)
    return x * np.minimum(1, t / 0.7) * np.minimum(1, (length - t) / 0.7)
def boom(length=2.5, low=32):
    n = int(length * SR); t = tt(n)
    f = low + 60 * np.exp(-t / 0.12)
    return np.tanh(1.8 * (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9) + 0.25 * rng.standard_normal(n) * np.exp(-t / 0.45)))
def riser(length):
    n = int(length * SR); t = tt(n); k = t / length
    nz = rng.standard_normal(n)
    tone = np.sin(2 * np.pi * np.cumsum(140 + 1100 * k ** 2) / SR)
    return (lowpass(nz, 40) * (1 - k) + highpass(nz, 3) * k * 0.6 + 0.3 * tone) * k ** 1.7
def whoosh(length, rise=0.6):
    n = int(length * SR); t = tt(n); k = t / length
    shape = np.where(k < rise, (k / rise) ** 2, ((1 - k) / (1 - rise)) ** 1.5)
    nz = rng.standard_normal(n)
    return (lowpass(nz, 6) * 0.7 + highpass(nz, 2) * 0.3) * shape
def scratch():
    # needle dragged off the record
    n = int(0.42 * SR); t = tt(n)
    f = 900 * np.exp(-t / 0.08) + 60
    return 0.6 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.25) + 0.3 * highpass(rng.standard_normal(n), 3) * np.exp(-t / 0.1)
def chime():
    n = int(1.6 * SR); t = tt(n)
    return sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t / d) for f, a, d in ((1318.5, 0.5, 0.7), (1760, 0.35, 0.5), (2637, 0.15, 0.3)))
def step(weight=1.0, soft=False):
    n = int(0.12 * SR); t = tt(n)
    thud = np.sin(2 * np.pi * (70 + 60 * np.exp(-t / 0.01)) * t) * np.exp(-t / 0.03)
    scuff = lowpass(rng.standard_normal(n), 3 if not soft else 6) * np.exp(-t / 0.02)
    return weight * (0.8 * thud + 0.35 * scuff)

def beats(t0, t1, step_):
    out, x = [], t0
    while x < t1 - 1e-6: out.append(x); x += step_
    return out

# ---- new instruments ---------------------------------------------------------------------
import json
def pluck(freq, length=0.35, muted=True):
    n = int(length * SR); t = tt(n)
    x = sum(np.sin(2 * np.pi * freq * h * t) / h ** 1.6 for h in (1, 2, 3, 4))
    return x * env(n, 0.002, 0.06 if muted else 0.25)
def sub808(f0, length, slide_to=None, drive=2.5):
    n = int(length * SR); t = tt(n)
    f = np.full(n, float(f0))
    if slide_to: f = f0 + (slide_to - f0) * np.clip(t / 0.09, 0, 1)
    ph = 2 * np.pi * np.cumsum(f) / SR
    click = np.sin(2 * np.pi * np.cumsum(f * (1 + 2 * np.exp(-t / 0.01))) / SR) * np.exp(-t / 0.015)
    return np.tanh(drive * (np.sin(ph) * np.minimum(1, t / 0.004) * np.exp(-t / (length * 0.9)) + 0.4 * click))
def braaam(length=3.0, root=41.2):
    n = int(length * SR); t = tt(n)
    x = 0
    for d in (-0.08, 0, 0.07, 0.15):                 # a stack of detuned saws, an octave and a fifth
        for mult, a in ((1, 1.0), (2, 0.5), (3, 0.3)):
            f = root * mult * (1 + d / 100 * mult)
            x = x + a * (2 * ((f * t + d) % 1) - 1)
    k = int(0.002 * SR) + 1
    x = lowpass(x, 3 + int(40 * np.clip(t[-1], 0, 1)))  # dark, brassy
    shape = np.minimum(1, t / 0.06) * np.exp(-t / (length * 0.55))
    return np.tanh(0.8 * x * shape) + 0.6 * boom(length, root * 0.75)
def choir(freqs, length):
    n = int(length * SR); t = tt(n)
    x = sum(np.sin(2 * np.pi * f * t + 0.4 * np.sin(2 * np.pi * 5.5 * t + f)) + 0.35 * np.sin(2 * np.pi * 3 * f * t) for f in freqs) / len(freqs)
    breath = lowpass(rng.standard_normal(n), 10) * 0.15
    return (x + breath) * np.minimum(1, t / 0.9) * np.minimum(1, (length - t) / 0.7)
def heartbeat():
    return kick(0.6)[: int(0.3 * SR)] * 0.9

def tape_stop(sig, length):
    # play sig slowing to a halt over `length` seconds
    n = int(length * SR); t = tt(n)
    speed = (1 - t / length) ** 1.5
    pos = np.cumsum(speed)
    pos = pos[pos < len(sig) - 1]
    return np.interp(pos, np.arange(len(sig)), sig) * np.linspace(1, 0.3, len(pos))

# ---- ambience: the city under everything -------------------------------------------------
amb = lowpass(np.cumsum(rng.standard_normal(N)) * 0.002, 50)
amb = amb - lowpass(amb, 4000)
traffic = lowpass(rng.standard_normal(N), 120) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * np.arange(N) / SR))
amb_level = np.ones(N)
amb_level[int(8.8 * SR):int(12.4 * SR)] = 0.35
amb_level[int(18.4 * SR):] = 0.0
add((amb * 6 + traffic * 0.5) * amb_level, 0, 0.5)
for t0, pan in ((1.2, -0.6), (9.4, 0.5), (16.4, 0.7)):
    add(lowpass(whoosh(3.0, 0.5), 30), t0, 0.12, pan)
crackle = np.zeros(N); pops = rng.integers(0, int(4.0 * SR), 140); crackle[pops] = rng.uniform(-1, 1, len(pops))
add(highpass(crackle, 2) * 0.5, 0, 0.12)

# ---- 0.0 - 4.0: cool minimal beat, built into its own buffer so it can tape-stop ---------
GROOVE_END = 4.0
groove = np.zeros(int((GROOVE_END + 0.6) * SR))
def gadd(sig, at, gain=1.0):
    i = int(at * SR); sig = sig[: len(groove) - i]; groove[i:i + len(sig)] += sig * gain
melody = [523.3, 0, 622.3, 0, 587.3, 523.3, 0, 466.2, 523.3, 0, 392.0, 0, 466.2, 0, 523.3, 0]
for i, b in enumerate(beats(0.0, GROOVE_END + 0.5, BEAT / 2)):
    f = melody[i % len(melody)]
    if f: gadd(pluck(f, 0.3), b, 0.11)
for i, b in enumerate(beats(0.0, GROOVE_END + 0.5, BEAT)):
    if i % 4 == 0: gadd(sub808(43.7, BEAT * 1.6, None, 1.6), b, 0.22)
    if i % 4 == 2: gadd(snare(0.4), b, 0.13)
    gadd(hat(), b + BEAT / 2, 0.12)
    gadd(kick(0.45), b if i % 4 == 0 else b + 10, 0.2)
add(groove[: int(GROOVE_END * SR)], 0, 1.0)
add(tape_stop(groove[int(GROOVE_END * SR):], 0.55), GROOVE_END, 1.0)
for i, b in enumerate(beats(0.25, 5.1, 0.535)):
    add(step(0.9, soft=True), b, 0.22, -0.2 if i % 2 else 0.2)

# ---- 4.0 - 6.8: the question, in near-silence ----------------------------------------------
add(pad([110.0, 164.8], 2.9, 0.05), 4.4, 0.04)

# ---- 6.8 - 8.8: she points: heartbeat and a riser ----------------------------------------
for b in (6.9, 7.15, 7.75, 7.95, 8.45, 8.6):
    add(heartbeat(), b, 0.5)
add(riser(2.0), 6.8, 0.38)

# ---- 8.8 - 12.4: the store ----------------------------------------------------------------
add(braaam(3.4, 41.2), 8.8, 0.9)
add(whoosh(1.8, 0.35), 8.75, 0.35, -0.3)
add(choir([196.0, 246.9, 293.7, 392.0], 3.6), 8.9, 0.22)
add(whoosh(1.4, 0.4), 10.5, 0.3, 0.3)
add(chime(), 10.75, 0.16, 0.2)
# hats rolling faster into the drop: 1/8, then 1/16, then 1/32
for t0, t1, div, g in ((10.6, 11.4, 2, 0.12), (11.4, 12.0, 4, 0.16), (12.0, 12.4, 8, 0.2)):
    for b in beats(t0, t1, BEAT / div): add(hat(), b, g, 0.2)
add(riser(1.6), 10.8, 0.4)

# ---- 12.4 - 15.8: the rush: trap drop ---------------------------------------------------
add(braaam(1.4, 55.0), 12.4, 0.45)
bar = BEAT * 4
pattern = [(0.0, 43.7, None), (0.75, 43.7, 49.0), (1.5, 49.0, None), (2.5, 43.7, 36.7), (3.25, 41.2, None)]
for k, b0 in enumerate(beats(12.4, 15.8, bar)):
    for off, f, slide in pattern:
        at = b0 + off * BEAT
        if at < 15.8: add(sub808(f, BEAT * 1.4, slide, 3.0), at, 0.5)
    for off in (0.0, 0.75, 2.5):
        if b0 + off * BEAT < 15.8: add(kick(1.0), b0 + off * BEAT, 0.6)
    if b0 + 2 * BEAT < 15.8: add(snare(1.0), b0 + 2 * BEAT, 0.55); add(clap(), b0 + 2 * BEAT, 0.35)
# hats: straight 1/8 with triplet rolls at the end of each bar
for b0 in beats(12.4, 15.8, bar):
    for b in beats(b0, b0 + 3 * BEAT, BEAT / 2): add(hat(), b, 0.25, 0.3)
    for b in beats(b0 + 3 * BEAT, b0 + 4 * BEAT, BEAT / 6): add(hat(), b, 0.2, -0.3)
add(choir([146.8, 196.0, 220.0], 3.4), 12.4, 0.08)
for k in range(170):
    at = 12.45 + 3.3 * rng.random()
    add(step(0.5 + rng.random() * 0.6), at, 0.12 + 0.3 * (at - 12.4) / 3.4, rng.uniform(-0.8, 0.8))
for t0, pan in ((13.5, -0.5), (14.2, 0.6), (14.8, -0.2), (15.3, 0.4)):
    add(whoosh(0.7, 0.55), t0, 0.35, pan)

# ---- 15.8 - 18.4: alone ------------------------------------------------------------------
add(tape_stop(sub808(43.7, 1.0, None, 3.0), 0.5), 15.8, 0.4)
add(pad([82.4, 123.5], 2.6, 0.05), 15.9, 0.06)

# ---- 18.0 - 21.0: the logo --------------------------------------------------------------
add(whoosh(0.45, 0.95), 17.98, 0.4)
add(braaam(2.6, 36.7), 18.45, 0.9)

# ---- voices (from ad/dialogue.json) and the mouth timing for the film --------------------
dialogue = json.load(open(os.path.join(HERE, "dialogue.json")))["lines"]
FPS = 30
lips = []
for d in dialogue:
    v = load_voice(d["line"])
    if d.get("muffle"): v = lowpass(v, d["muffle"])
    add(v, d["at"], d["gain"], d.get("pan", 0))
    if d.get("speaker"):
        hop = SR // FPS
        rms = np.array([np.sqrt(np.mean(v[i:i + hop] ** 2)) for i in range(0, len(v), hop)])
        ref = np.percentile(rms[rms > 0], 90) if (rms > 0).any() else 1
        e = np.clip(rms / (ref + 1e-9), 0, 1)
        e = np.convolve(e, [0.25, 0.5, 0.25], mode="same")
        e[e < 0.18] = 0
        lips.append({"speaker": d["speaker"], "at": d["at"], "env": [round(float(x), 3) for x in e]})
json.dump({"fps": FPS, "lines": lips}, open(os.path.join(HERE, "audio", "lipsync.json"), "w"))

# ---- master -------------------------------------------------------------------------------
mix = np.stack([L, R], axis=1)
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(1.4 * mix) / np.tanh(1.4)
fade = np.minimum(1, (DUR - np.arange(N) / SR) / 0.5)[:, None]
mix *= fade * 0.95
pcm = (mix * 32767).astype(np.int16)
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", sys.argv[1])
