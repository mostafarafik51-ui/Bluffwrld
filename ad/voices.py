# Character voices for the store film, made with Piper text-to-speech (runs locally).
#   python3 ad/voices.py <voices dir>
# The voice models (downloaded from huggingface.co/rhasspy/piper-voices) go in <voices dir>:
#   en_US-hfc_female-medium, en_US-hfc_male-medium, en_US-libritts_r-medium (904 speakers, CC BY 4.0)
import sys, os, wave
from piper import PiperVoice, SynthesisConfig

vdir = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), "audio")
os.makedirs(out, exist_ok=True)
voices = {}
def voice(name):
    if name not in voices:
        voices[name] = PiperVoice.load(os.path.join(vdir, name + ".onnx"))
    return voices[name]

# (file, voice model, speaker id, text, speed: >1 slower, expressiveness)
LINES = [
    ("a_monday",     "en_US-libritts_r-medium", 92,  "Nah. Not on a Monday.",            1.0, 0.75),
    ("c_really",     "en_US-hfc_male-medium",   None, "He really said that?",            0.95, 0.8),
    ("b_wait",       "en_US-hfc_female-medium", None, "Wait.",                            1.15, 0.6),
    ("b_where",      "en_US-hfc_female-medium", None, "Where did you get that?",         1.02, 0.85),
    ("a_noway",      "en_US-libritts_r-medium", 92,  "No way.",                           1.1, 0.8),
    ("crowd_lets",   "en_US-hfc_male-medium",   None, "Let's go!",                        0.85, 0.9),
    ("crowd_move",   "en_US-libritts_r-medium", 40,  "Move, move!",                       0.85, 0.9),
    ("crowd_wait",   "en_US-libritts_r-medium", 300, "Wait for me!",                      0.9, 0.9),
    ("crowd_bluff",  "en_US-libritts_r-medium", 512, "It's the Bluff store!",             0.9, 0.9),
]
# murmur: lots of different people talking at once, used low and muffled
MURMUR = ["did you see that", "where is it", "that bag though", "come on", "is it open",
          "no way", "I need one", "how much is it", "right there", "look at the line"]

def synth(fname, model, spk, text, speed, expr):
    cfg = SynthesisConfig(speaker_id=spk, length_scale=speed, noise_scale=0.667 * expr + 0.2, noise_w_scale=0.8)
    with wave.open(os.path.join(out, fname + ".wav"), "wb") as wf:
        voice(model).synthesize_wav(text, wf, syn_config=cfg)

for l in LINES:
    synth(*l)
for i, text in enumerate(MURMUR):
    synth("murmur_%02d" % i, "en_US-libritts_r-medium", 17 + i * 83, text, 0.95 + 0.05 * (i % 3), 0.9)
print("voices written to", out)
