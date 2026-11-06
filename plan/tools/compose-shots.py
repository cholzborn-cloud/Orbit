#!/usr/bin/env python3
# Legt Web (links) und nativ (rechts) nebeneinander: compose-shots.py <web.png> <nativ.png> <ziel.png>
import sys
from PIL import Image
web, nat, out = (Image.open(sys.argv[1]).convert("RGB"), Image.open(sys.argv[2]).convert("RGB"), sys.argv[3])
gap = 16
canvas = Image.new("RGB", (web.width + nat.width + gap, max(web.height, nat.height)), (128, 128, 128))
canvas.paste(web, (0, 0)); canvas.paste(nat, (web.width + gap, 0))
canvas.save(out)
