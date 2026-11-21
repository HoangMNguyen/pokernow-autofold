#!/usr/bin/env python3
"""Generate the extension's icons and alert chime (stdlib only).

Usage: python3 tools/make-assets.py   (writes assets/icon{16,48,128}.png, assets/alert.wav)
"""
import math
import os
import struct
import wave
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')

FELT = (31, 122, 77)
CARD = (255, 255, 255)
PIP = (214, 40, 40)
EDGE = (16, 70, 44)


def rounded_rect(x, y, cx, cy, hw, hh, r):
    """True if (x, y) lies in an axis-aligned rounded rect centred at (cx, cy)."""
    dx = abs(x - cx) - (hw - r)
    dy = abs(y - cy) - (hh - r)
    if dx <= 0 or dy <= 0:
        return abs(x - cx) <= hw and abs(y - cy) <= hh
    return dx * dx + dy * dy <= r * r


def rotate(x, y, cx, cy, deg):
    a = math.radians(deg)
    dx, dy = x - cx, y - cy
    return cx + dx * math.cos(a) + dy * math.sin(a), cy - dx * math.sin(a) + dy * math.cos(a)


def shade(u, v):
    """Colour (RGBA) at unit coordinates u, v in [0, 1]."""
    if not rounded_rect(u, v, 0.5, 0.5, 0.5, 0.5, 0.2):
        return None
    cu, cv = rotate(u, v, 0.52, 0.52, -14)
    if rounded_rect(cu, cv, 0.52, 0.52, 0.25, 0.34, 0.06):
        # diamond pip in the middle of the card
        if abs(cu - 0.52) / 0.14 + abs(cv - 0.52) / 0.19 <= 1:
            return PIP
        return CARD
    if rounded_rect(cu, cv, 0.52, 0.52, 0.28, 0.37, 0.08):
        return EDGE
    return FELT


def render(size, ss=4):
    rows = []
    for py in range(size):
        row = bytearray([0])  # filter type None
        for px in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    if c:
                        r += c[0]
                        g += c[1]
                        b += c[2]
                        a += 1
            n = ss * ss
            if a:
                row += bytes((r // a, g // a, b // a, round(255 * a / n)))
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b''.join(rows)


def png(size):
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(render(size), 9)) + chunk(b'IEND', b''))


def chime(path, rate=44100):
    """Two-tone ascending chime (E5 then A5), bell-like decay, ~0.75 s."""
    notes = [(659.25, 0.0), (880.0, 0.16)]
    length = int(rate * 0.75)
    samples = [0.0] * length
    for freq, start in notes:
        s0 = int(start * rate)
        for i in range(length - s0):
            t = i / rate
            attack = min(1.0, t / 0.006)
            env = attack * math.exp(-t * 6.0)
            tone = (math.sin(2 * math.pi * freq * t)
                    + 0.3 * math.sin(2 * math.pi * 2 * freq * t) * math.exp(-t * 10.0)
                    + 0.1 * math.sin(2 * math.pi * 3 * freq * t) * math.exp(-t * 16.0))
            samples[s0 + i] += env * tone
    fade = int(rate * 0.05)
    for i in range(fade):
        samples[length - 1 - i] *= i / fade
    peak = max(abs(s) for s in samples) or 1.0
    scale = 0.55 * 32767 / peak
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b''.join(struct.pack('<h', int(s * scale)) for s in samples))


def main():
    os.makedirs(ASSETS, exist_ok=True)
    for size in (16, 48, 128):
        with open(os.path.join(ASSETS, 'icon%d.png' % size), 'wb') as f:
            f.write(png(size))
    chime(os.path.join(ASSETS, 'alert.wav'))


if __name__ == '__main__':
    main()
