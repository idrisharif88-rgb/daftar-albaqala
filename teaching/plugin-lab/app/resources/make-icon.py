"""
«Blocks» launcher icon — a green gear with a small block in its centre, on a soft green tile.
Re-run to regenerate:  python3 resources/make-icon.py
«Blocks»-ikon — et grønt tannhjul med en liten blokk i midten, på en myk grønn bakgrunn.

Needs only Pillow. Drawn at 4x and shrunk, so edges are smooth.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

RES = Path(__file__).resolve().parent.parent / "android/app/src/main/res"
GREEN, TILE, CLEAR = (27, 94, 32, 255), (232, 245, 233, 255), (0, 0, 0, 0)
SS = 4                                          # supersampling

# Design space = Android's 108-unit adaptive canvas, gear centred at (54, 54).
# The gear's tips reach radius 30, inside the 33-unit safe zone, so no launcher shape cuts it.
TEETH, R_TIP, R_ROOT, R_HOLE, BLOCK = 8, 30, 23, 11.5, 6.5

def draw_gear(d, to_px, k, hole_fill):
    """Gear = body circle + teeth (trapezoids) − round hole + a rounded block inside the hole."""
    def P(x, y): return to_px(54 + x * k, 54 + y * k)
    def ring(r, a): return P(r * math.cos(a), r * math.sin(a))
    ax, ay = P(-R_ROOT, -R_ROOT); bx, by = P(R_ROOT, R_ROOT)
    d.ellipse([ax, ay, bx, by], fill=GREEN)
    for i in range(TEETH):
        a = math.radians(i * 360 / TEETH)
        d.polygon([ring(R_ROOT - 1.5, a - math.radians(15)), ring(R_TIP, a - math.radians(9.5)),
                   ring(R_TIP, a + math.radians(9.5)), ring(R_ROOT - 1.5, a + math.radians(15))], fill=GREEN)
    ax, ay = P(-R_HOLE, -R_HOLE); bx, by = P(R_HOLE, R_HOLE)
    d.ellipse([ax, ay, bx, by], fill=hole_fill)
    ax, ay = P(-BLOCK, -BLOCK); bx, by = P(BLOCK, BLOCK)
    d.rounded_rectangle([ax, ay, bx, by], radius=2.2 * (bx - ax) / (2 * BLOCK), fill=GREEN)

def foreground(px):                             # adaptive layer: transparent, 108 units
    img = Image.new("RGBA", (px * SS, px * SS), CLEAR)
    u = px * SS / 108
    draw_gear(ImageDraw.Draw(img), lambda x, y: (x * u, y * u), 1.0, CLEAR)
    return img.resize((px, px), Image.LANCZOS)

def legacy(px, round_):                         # old-style icon: tile included, 72 units visible
    img = Image.new("RGBA", (px * SS, px * SS), CLEAR)
    d = ImageDraw.Draw(img); full = px * SS
    if round_: d.ellipse([0, 0, full - 1, full - 1], fill=TILE)
    else: d.rounded_rectangle([0, 0, full - 1, full - 1], radius=full * 0.22, fill=TILE)
    u = full / 72
    draw_gear(d, lambda x, y: ((x - 18) * u, (y - 18) * u), 1.12, TILE)
    return img.resize((px, px), Image.LANCZOS)

DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for name, f in DENSITIES.items():
    folder = RES / f"mipmap-{name}"
    foreground(round(108 * f)).save(folder / "ic_launcher_foreground.png")
    legacy(round(48 * f), False).save(folder / "ic_launcher.png")
    legacy(round(48 * f), True).save(folder / "ic_launcher_round.png")

(RES / "values" / "ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#E8F5E9</color>\n</resources>\n')

# A big preview for checking by eye (not shipped). / Et stort forhåndsbilde (leveres ikke).
preview = Image.new("RGBA", (1100, 560), (255, 255, 255, 255))
preview.paste(legacy(512, False), (20, 24), legacy(512, False))
bg = Image.new("RGBA", (432, 432), TILE); bg.alpha_composite(foreground(432))
mask = Image.new("L", (432, 432), 0); ImageDraw.Draw(mask).ellipse([0, 0, 431, 431], fill=255)
preview.paste(bg, (590, 60), mask)
preview.save(Path(__file__).parent / "icon-preview.png")
print("icons written")
