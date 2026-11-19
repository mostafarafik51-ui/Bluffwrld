# Full soundtrack for the store film: music, sound effects and the characters' voices.
#   python3 ad/sound.py <out.wav>
# Everything is synthesised here except the voices (ad/audio/*.wav, made by ad/voices.py).
#
#  0.0   street: city ambience, a laid-back groove, her footsteps, the friends chatting
#  4.0   "Wait."            the groove stops dead (needle off the record)
#  5.15  "Where did you get that?"   in near-silence, just the street
#  6.8   she points: a riser builds, "No way."
#  8.8   the store: a deep hit, a wide shimmering pad, a whoosh with the crane
# 10.6   inside: a door chime, the murmur of people starting to realise, a snare roll
# 12.4   THE RUSH: the drop, hard drums and bass, a stampede of footsteps, shouts
# 15.8   everything cuts: ambience, distant crowd noise from the store, her alone
# 18.0   reverse swell into a final hit on the logo
import sys, os, wave
import numpy as np

SR = 44100
DUR = 21.0
BPM = 120.0
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

# ---- ambience: the city under everything ---------------------------------------------
amb = lowpass(np.cumsum(rng.standard_normal(N)) * 0.002, 50)
amb = amb - lowpass(amb, 4000)
traffic = lowpass(rng.standard_normal(N), 120) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.07 * np.arange(N) / SR))
amb_level = np.ones(N)
amb_level[int(8.8 * SR):int(12.4 * SR)] = 0.35            # inside the store / the reveal: quieter street
amb_level[int(18.4 * SR):] = 0.0
add((amb * 6 + traffic * 0.5) * amb_level, 0, 0.5)
for t0, pan in ((1.2, -0.6), (9.4, 0.5), (16.4, 0.7)):        # cars passing far away
    add(lowpass(whoosh(3.0, 0.5), 30), t0, 0.12, pan)

# ---- 0.0 - 4.0: laid-back groove under the conversation ---------------------------------
GROOVE_END = 4.0
for i, b in enumerate(beats(0.0, GROOVE_END, BEAT)):
    add(kick(0.5), b, 0.3)
    if i % 2 == 1: add(clap(), b, 0.18, 0.1)
    add(hat(), b + BEAT / 2, 0.22, -0.3)
for i, b in enumerate(beats(0.0, GROOVE_END, BEAT * 2)):
    add(keys([220.0, 261.6, 329.6] if i % 2 == 0 else [196.0, 246.9, 293.7], BEAT * 1.9), b, 0.16)
    add(bass(55.0 if i % 2 == 0 else 49.0, BEAT * 1.6, 1.4), b, 0.22)
add(scratch(), GROOVE_END - 0.02, 0.45)
# her footsteps while she walks (stops at ~5.1)
for i, b in enumerate(beats(0.25, 5.1, 0.535)):
    add(step(0.9, soft=True), b, 0.22, -0.2 if i % 2 else 0.2)

# ---- 4.0 - 6.8: the question, in near-silence ------------------------------------------
add(pad([110.0, 164.8], 2.9, 0.05), 4.1, 0.05)                   # a held breath of a pad

# ---- 6.8 - 8.8: she points -------------------------------------------------------------
add(riser(2.0), 6.8, 0.42)
add(pad([73.4, 110.0, 146.8], 2.1, 0.2), 6.8, 0.15)
for b in beats(8.2, 8.8, BEAT / 4):
    add(snare(0.3), b, 0.08 + 0.35 * (b - 8.2))

# ---- 8.8 - 12.4: the store ---------------------------------------------------------------
add(boom(3.2, 30), 8.8, 0.85)
add(whoosh(1.8, 0.35), 8.75, 0.35, -0.3)                        # the crane up the facade
add(pad([65.4, 98.0, 130.8, 164.8, 196.0, 261.6], 3.7, 0.55), 8.8, 0.3)
for i, b in enumerate(beats(9.2, 12.4, BEAT / 2)):               # shimmer
    add(np.sin(2 * np.pi * [1046.5, 1318.5, 1568.0, 1318.5][i % 4] * tt(int(0.4 * SR))) * env(int(0.4 * SR), 0.003, 0.15), b, 0.05, 0.4 if i % 2 else -0.4)
add(whoosh(1.4, 0.4), 10.5, 0.3, 0.3)                           # gliding in through the doors
add(chime(), 10.75, 0.18, 0.2)
for b in beats(9.8, 12.4, BEAT):
    add(kick(0.7), b, 0.35)
add(riser(1.5), 10.9, 0.45)
for b in beats(11.4, 12.4, BEAT / 4):
    add(snare(1.0), b, 0.05 + 0.4 * (b - 11.4))

# ---- 12.4 - 15.8: the rush --------------------------------------------------------------
add(boom(1.6, 40), 12.4, 0.75)
notes = [55.0, 55.0, 65.4, 55.0, 73.4, 55.0, 65.4, 82.4]
for i, b in enumerate(beats(12.4, 15.8, BEAT / 4)):
    add(hat(i % 8 == 6), b, 0.32 if i % 2 else 0.2, 0.3 if i % 2 else -0.3)
    if i % 2 == 0: add(bass(notes[(i // 2) % len(notes)], BEAT / 4 * 1.8, 4.5), b, 0.3)
for i, b in enumerate(beats(12.4, 15.8, BEAT)):
    add(kick(1.0), b, 0.7)
    if i % 2 == 1: add(snare(1.0), b, 0.5); add(clap(), b, 0.25)
add(pad([110.0, 130.8, 164.8], 3.4, 0.7), 12.4, 0.12)
# the stampede: many feet, louder as they reach the camera, panned across
for k in range(170):
    at = 12.45 + 3.3 * rng.random()
    closeness = (at - 12.4) / 3.4
    add(step(0.5 + rng.random() * 0.6), at, 0.12 + 0.3 * closeness, rng.uniform(-0.8, 0.8))
for t0, pan in ((13.5, -0.5), (14.2, 0.6), (14.8, -0.2), (15.3, 0.4)):   # people tearing past the camera
    add(whoosh(0.7, 0.55), t0, 0.35, pan)

# ---- 15.8 - 18.4: alone -----------------------------------------------------------------
add(hat(True), 15.8, 0.25)
add(boom(1.2, 50), 15.8, 0.2)                                    # the drop pulls out under her
add(pad([82.4, 123.5], 2.6, 0.05), 15.85, 0.07)

# ---- 18.0 - 21.0: the logo ----------------------------------------------------------------
rev = whoosh(0.45, 0.95)
add(rev, 17.98, 0.4)
add(boom(2.6, 30), 18.45, 0.95)
add(chime(), 18.5, 0.08)

# ---- voices -----------------------------------------------------------------------------
def say(name, at, gain=1.0, pan=0.0, muffle=0):
    v = load_voice(name)
    if muffle: v = lowpass(v, muffle)
    add(v, at, gain, pan)
say("a_monday", 0.45, 0.75, 0.25)
say("c_really", 2.2, 0.75, 0.15)
say("b_wait", 4.05, 0.95, 0.1)
say("b_where", 5.1, 1.0, 0.1)
say("a_noway", 7.45, 0.6, 0.2)
# people starting to realise (off screen, under the store shots)
for i, at in enumerate([10.9, 11.15, 11.4, 11.6, 11.8, 12.0, 12.15]):
    say("murmur_%02d" % i, at, 0.10 + 0.04 * i, (-0.6, 0.5, -0.2, 0.7, -0.5, 0.3, 0.0)[i], muffle=3)
say("crowd_lets", 12.45, 0.55, 0.3)
say("crowd_move", 12.95, 0.4, -0.5)
say("crowd_wait", 13.7, 0.35, 0.6)
# the crowd far away inside the store, while she stands alone
for i, at in enumerate([16.0, 16.4, 16.9, 17.3]):
    say("murmur_%02d" % (7 + i % 3), at, 0.07, (-0.3, 0.3, 0.0, -0.2)[i], muffle=8)

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
