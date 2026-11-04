#!/usr/bin/python3 -I
"""Generate the soft, minimal "I Found You" sound theme (original sounds)."""
import math, struct, wave, os, sys

RATE = 44100
OUT = sys.argv[1]

def note(freq, dur, vol=0.35, attack=0.008, decay=4.0, harmonics=((1, 1.0), (2, 0.18), (3, 0.05))):
    """A soft bell/marimba-like tone: quick fade-in, smooth exponential fade-out."""
    n = int(RATE * dur)
    out = []
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / attack) * math.exp(-decay * t)
        s = sum(a * math.sin(2 * math.pi * freq * h * t) for h, a in harmonics)
        out.append(vol * env * s)
    return out

def silence(dur):
    return [0.0] * int(RATE * dur)

def mix(*tracks):
    """Overlay tracks; each item is (start_seconds, samples)."""
    length = max(int(st * RATE) + len(s) for st, s in tracks)
    buf = [0.0] * length
    for st, s in tracks:
        o = int(st * RATE)
        for i, v in enumerate(s):
            buf[o + i] += v
    return buf

def save(name, samples, gain=1.0):
    # gentle fade at the very end + soft limiter, stereo 16-bit
    peak = max(1e-9, max(abs(x) for x in samples))
    norm = min(1.0, 0.9 / peak) * gain
    fade = int(RATE * 0.03)
    for i in range(fade):
        samples[-1 - i] *= i / fade
    path = os.path.join(OUT, name + ".wav")
    with wave.open(path, "w") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE)
        frames = bytearray()
        for v in samples:
            x = int(max(-1.0, min(1.0, v * norm)) * 32767)
            frames += struct.pack("<hh", x, x)
        w.writeframes(bytes(frames))

# Pitches (warm, minor-ish, nothing piercing)
A4, C5, D5, E5, G5, A5 = 440.0, 523.25, 587.33, 659.25, 783.99, 880.0
A3, E4 = 220.0, 329.63

# Notification: two soft notes, falling gently (E5 -> A4)
save("message-new-instant", mix((0, note(E5, 0.6, decay=6)), (0.11, note(A4, 0.8, decay=5))), 0.55)
save("message", mix((0, note(E5, 0.6, decay=6)), (0.11, note(A4, 0.8, decay=5))), 0.55)
# Generic info / bell: single soft drop
save("bell", note(A5, 0.5, decay=8), 0.45)
save("dialog-information", note(E5, 0.6, decay=7), 0.5)
# Warning / error: low, calm, two notes
save("dialog-warning", mix((0, note(E4, 0.7, decay=5)), (0.14, note(A3, 0.9, decay=4))), 0.6)
save("dialog-error", mix((0, note(E4, 0.7, decay=5)), (0.14, note(A3, 0.9, decay=4))), 0.6)
# Done / complete: soft rising pair
save("complete", mix((0, note(A4, 0.6, decay=6)), (0.1, note(E5, 0.8, decay=5))), 0.5)
# Charger plugged / unplugged
save("power-plug", mix((0, note(A4, 0.4, decay=8)), (0.08, note(D5, 0.6, decay=6))), 0.45)
save("power-unplug", mix((0, note(D5, 0.4, decay=8)), (0.08, note(A4, 0.6, decay=6))), 0.45)
# USB / device added / removed
save("device-added", mix((0, note(C5, 0.4, decay=9)), (0.07, note(G5, 0.5, decay=8))), 0.4)
save("device-removed", mix((0, note(G5, 0.4, decay=9)), (0.07, note(C5, 0.5, decay=8))), 0.4)
# Screenshot: tiny soft tick
save("screen-capture", note(1760, 0.12, decay=40, harmonics=((1, 1.0),)), 0.35)
# Volume change: very quiet tick
save("audio-volume-change", note(A5, 0.12, decay=30, harmonics=((1, 1.0),)), 0.3)
# Trash emptied: soft falling
save("trash-empty", mix((0, note(G5, 0.3, decay=10)), (0.06, note(C5, 0.5, decay=8))), 0.35)
# Login / startup: slow warm arpeggio A3 - E4 - A4 - E5, like light fading in
start = mix((0.00, note(A3, 2.6, vol=0.30, decay=1.4)),
            (0.18, note(E4, 2.4, vol=0.26, decay=1.5)),
            (0.36, note(A4, 2.2, vol=0.22, decay=1.6)),
            (0.60, note(E5, 2.0, vol=0.16, decay=1.7)))
save("desktop-login", start, 0.6)
save("service-login", start, 0.6)
print("ok")
