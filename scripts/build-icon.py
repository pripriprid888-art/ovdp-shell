#!/usr/bin/env python3
"""Build assets/icon.png (512) and assets/icon.icns from flat vector artwork."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
SOURCE = ASSETS / 'icon-1024.png'
PNG_OUT = ASSETS / 'icon.png'
ICNS_OUT = ASSETS / 'icon.icns'
ICO_OUT = ASSETS / 'icon.ico'

SIZE = 1024
BG = (26, 26, 46)  # #1a1a2e
GOLD = (201, 162, 39)  # #c9a227


def draw_icon() -> Image.Image:
    img = Image.new('RGB', (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(img)

    margin = int(SIZE * 0.16)
    span = SIZE - margin * 2
    cx = SIZE // 2
    top = margin
    bottom = SIZE - margin
    leg = int(span * 0.15)

    # Ascending bars (bond growth)
    bar_w = int(span * 0.11)
    gap = int(span * 0.05)
    x = margin
    for ratio in (0.38, 0.56, 0.74):
        h = int(span * ratio)
        draw.rectangle([x, bottom - h, x + bar_w, bottom], fill=GOLD)
        x += bar_w + gap

    # Bond certificate
    doc_x = x + int(span * 0.04)
    doc_w = int(span * 0.42)
    doc_h = int(span * 0.78)
    doc_y = bottom - doc_h
    fold = int(doc_w * 0.24)
    draw.rectangle([doc_x, doc_y + fold, doc_x + doc_w, bottom], fill=GOLD)
    draw.polygon([
        (doc_x + doc_w - fold, doc_y),
        (doc_x + doc_w, doc_y + fold),
        (doc_x + doc_w - fold, doc_y + fold),
    ], fill=BG)
    draw.rectangle([doc_x, doc_y + fold, doc_x + doc_w - fold, doc_y + fold], fill=GOLD)

    # Alpha "A" monogram on the certificate
    letter_top = doc_y + int(doc_h * 0.18)
    letter_bottom = bottom - int(doc_h * 0.22)
    letter_cx = doc_x + doc_w // 2
    letter_half = int(doc_w * 0.22)
    cross_y = letter_top + int((letter_bottom - letter_top) * 0.46)
    draw.polygon([
        (letter_cx, letter_top),
        (letter_cx + letter_half, letter_bottom),
        (letter_cx + letter_half - leg, letter_bottom),
        (letter_cx + int(letter_half * 0.2), cross_y + int(leg * 0.9)),
        (letter_cx - int(letter_half * 0.2), cross_y + int(leg * 0.9)),
        (letter_cx - letter_half + leg, letter_bottom),
        (letter_cx - letter_half, letter_bottom),
    ], fill=BG)
    bar_h = max(4, int(leg * 0.85))
    draw.rectangle([
        letter_cx - int(letter_half * 0.72),
        cross_y - bar_h // 2,
        letter_cx + int(letter_half * 0.72),
        cross_y + bar_h // 2,
    ], fill=BG)

    return img


def build_ico(source: Path, destination: Path) -> None:
    img = Image.open(source).convert('RGBA')
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(destination, format='ICO', sizes=sizes)


def build_icns(source: Path, destination: Path) -> None:
    iconset = ASSETS / 'icon.iconset'
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()

    sizes = (16, 32, 128, 256, 512)
    for size in sizes:
        out = iconset / f'icon_{size}x{size}.png'
        subprocess.run(
            ['sips', '-z', str(size), str(size), str(source), '--out', str(out)],
            check=True,
            stdout=subprocess.DEVNULL,
        )

    subprocess.run(['sips', '-z', '32', '32', str(source), '--out', str(iconset / 'icon_16x16@2x.png')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['sips', '-z', '64', '64', str(source), '--out', str(iconset / 'icon_32x32@2x.png')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['sips', '-z', '256', '256', str(source), '--out', str(iconset / 'icon_128x128@2x.png')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['sips', '-z', '512', '512', str(source), '--out', str(iconset / 'icon_256x256@2x.png')], check=True, stdout=subprocess.DEVNULL)

    subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(destination)], check=True)
    shutil.rmtree(iconset)


def main() -> int:
    ASSETS.mkdir(exist_ok=True)
    source = draw_icon()
    source.save(SOURCE, format='PNG', optimize=True)

    subprocess.run(
        ['sips', '-z', '512', '512', str(SOURCE), '--out', str(PNG_OUT)],
        check=True,
        stdout=subprocess.DEVNULL,
    )

    build_icns(SOURCE, ICNS_OUT)
    build_ico(SOURCE, ICO_OUT)
    print(f'Wrote {PNG_OUT}, {ICNS_OUT}, and {ICO_OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
