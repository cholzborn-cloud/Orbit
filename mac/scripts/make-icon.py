#!/usr/bin/env python3
# Zeichnet das Orbit-App-Icon (Planet, Orbit-Ring, Mond auf tiefem Nachtblau) und schreibt den AppIcon-Satz.
import json, math, os
from PIL import Image, ImageDraw, ImageFilter

S = 2048  # doppelt gezeichnet, dann auf 1024 verkleinert
out = os.path.join(os.path.dirname(__file__), "..", "Orbit", "Assets.xcassets", "AppIcon.appiconset")

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# Hintergrund: diagonaler Verlauf Nachtblau -> Violett
bg = Image.new("RGB", (S, S))
px = bg.load()
for y in range(S):
    for x in range(S):
        px[x, y] = lerp((10, 14, 38), (58, 28, 104), (x * 0.4 + y * 0.8) / (S * 1.2))
img = bg.convert("RGBA")

def glow(center, r, color, blur, alpha):
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(layer).ellipse([center[0]-r, center[1]-r, center[0]+r, center[1]+r], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(blur))

c = (S // 2, S // 2)
img = Image.alpha_composite(img, glow(c, 520, (120, 90, 255), 220, 150))

# Sterne
import random
random.seed(7)
st = Image.new("RGBA", (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(st)
for _ in range(60):
    x, y, r = random.randint(60, S-60), random.randint(60, S-60), random.choice([3, 4, 6])
    d.ellipse([x-r, y-r, x+r, y+r], fill=(255, 255, 255, random.randint(70, 170)))
img = Image.alpha_composite(img, st)

# Planet mit Verlauf
R = 400
planet = Image.new("RGBA", (S, S), (0, 0, 0, 0)); pp = planet.load()
for y in range(c[1]-R, c[1]+R):
    for x in range(c[0]-R, c[0]+R):
        dx, dy = x - c[0], y - c[1]
        if dx*dx + dy*dy <= R*R:
            t = min(1, max(0, ((dx + dy) / (2.0 * R) + 1) / 2))
            col = lerp((255, 214, 150), (214, 84, 120), t ** 0.9)
            pp[x, y] = col + (255,)
planet = Image.alpha_composite(planet, glow((c[0]-150, c[1]-170), 190, (255, 255, 255), 70, 90))
mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).ellipse([c[0]-R, c[1]-R, c[0]+R, c[1]+R], fill=255)
planet.putalpha(Image.composite(planet.getchannel("A"), Image.new("L", (S, S), 0), mask))

# Orbit-Ring: Ellipse, gekippt; hinterer Teil vor, vorderer Teil nach dem Planeten
def ring(front):
    layer = Image.new("RGBA", (S * 1, S * 1), (0, 0, 0, 0))
    rw, rh, tilt = 760, 230, -22
    ell = Image.new("RGBA", (2 * rw + 40, 2 * rh + 40), (0, 0, 0, 0))
    ImageDraw.Draw(ell).ellipse([20, 20, 2*rw+20, 2*rh+20], outline=(255, 255, 255, 235), width=34)
    half = Image.new("L", ell.size, 0)
    hd = ImageDraw.Draw(half)
    hd.rectangle([0, ell.size[1]//2 if front else 0, ell.size[0], ell.size[1] if front else ell.size[1]//2], fill=255)
    ell.putalpha(Image.composite(ell.getchannel("A"), Image.new("L", ell.size, 0), half))
    ell = ell.rotate(tilt, expand=True, resample=Image.BICUBIC)
    layer.paste(ell, (c[0] - ell.size[0]//2, c[1] - ell.size[1]//2), ell)
    return layer

img = Image.alpha_composite(img, ring(False))
img = Image.alpha_composite(img, planet)
img = Image.alpha_composite(img, ring(True))

# Mond auf dem Ring (oben rechts)
t = math.radians(-22)
a = math.radians(-50)
mx = c[0] + 760 * math.cos(a) * math.cos(t) - 230 * math.sin(a) * math.sin(t)
my = c[1] + 760 * math.cos(a) * math.sin(t) + 230 * math.sin(a) * math.cos(t)
img = Image.alpha_composite(img, glow((mx, my), 90, (140, 200, 255), 50, 200))
moon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(moon).ellipse([mx-62, my-62, mx+62, my+62], fill=(235, 246, 255, 255))
img = Image.alpha_composite(img, moon)

# macOS-Form: Rundung 22,5 %, Inhalt mit Rand (Icon-Raster 824 von 1024)
full = img.resize((1024, 1024), Image.LANCZOS)
body = full.resize((824, 824), Image.LANCZOS)
m = Image.new("L", (824 * 4, 824 * 4), 0)
ImageDraw.Draw(m).rounded_rectangle([0, 0, 824*4-1, 824*4-1], radius=int(824*4*0.225), fill=255)
m = m.resize((824, 824), Image.LANCZOS)
body.putalpha(m)
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
shadow = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
shadow.paste((0, 0, 0, 110), (100, 112), m)
canvas = Image.alpha_composite(canvas, shadow.filter(ImageFilter.GaussianBlur(14)))
canvas.paste(body, (100, 100), body)
canvas.save(os.path.join(os.path.dirname(__file__), "..", "..", "plan", "screens", "app-icon-1024.png"))

images = []
for size in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
        canvas.resize((size * scale, size * scale), Image.LANCZOS).save(os.path.join(out, name))
        images.append({"idiom": "mac", "size": f"{size}x{size}", "scale": f"{scale}x", "filename": name})
json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, open(os.path.join(out, "Contents.json"), "w"), indent=2)
