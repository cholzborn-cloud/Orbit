#!/usr/bin/env python3
# Untere 520 px beider Bilder (Composer mit Modellwahl) nebeneinander, Web links: compose-composer.py <web.png> <nativ.png> <ziel.png>
import sys
from PIL import Image
w, n = Image.open(sys.argv[1]).convert("RGB"), Image.open(sys.argv[2]).convert("RGB")
box = lambda im: im.crop((max(0, im.width - 680), max(0, im.height - 560), im.width, im.height))
a, b = box(w), box(n)
c = Image.new("RGB", (a.width + b.width + 16, max(a.height, b.height)), (128, 128, 128))
c.paste(a, (0, 0)); c.paste(b, (a.width + 16, 0)); c.save(sys.argv[3])
