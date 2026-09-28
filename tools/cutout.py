"""Build transparent product cut-outs from the Deco renders.

Decorated renders only exist as JPEG on white; the matching blank garment is
available as a transparent PNG with identical framing. Take the blank's alpha
and un-premultiply the render against white so edges carry no white halo.
"""
import json, os
import numpy as np
from PIL import Image

P = json.load(open('raw/products.json'))
SRC, OUT = 'raw600', 'cut'
os.makedirs(OUT, exist_ok=True)

def cut(deco_path, blank_path):
    blank = np.asarray(Image.open(blank_path).convert('RGBA')).astype(np.float32) / 255
    a = blank[..., 3:4]
    if deco_path is None:
        rgb = blank[..., :3]
    else:
        d = np.asarray(Image.open(deco_path).convert('RGB')).astype(np.float32) / 255
        safe = np.maximum(a, 1e-3)
        rgb = np.clip((d - (1 - a)) / safe, 0, 1)      # un-premultiply against white
        rgb = np.where(a > 0.02, rgb, 0)
    out = np.concatenate([rgb, a], axis=2)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')

def on_white(im):
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    return np.asarray(bg.convert('L').resize((150, 150))).astype(np.float32)

report, manifest = [], {}
for p in P:
    listing = on_white(Image.open(f'{SRC}/L_{p["id"]}.png').convert('RGBA'))
    views = [v for v in p['views'] if v['deco'] or v['name'] == 'Back']
    entry = {'colors': {}, 'primary': None}
    scores = {}
    for c in p['colors']:
        files = []
        for v in views:
            blank = f'{SRC}/T_{v["id"]}_{c["id"]}.png'
            deco = f'{SRC}/D_{p["id"]}_{v["id"]}_{c["id"]}.jpg' if v['deco'] else None
            if not os.path.exists(blank) or (deco and not os.path.exists(deco)):
                report.append(f'MISSING {p["id"]} {v["name"]} {c["name"]}'); continue
            im = cut(deco, blank)
            if deco:  # alignment check: garment body should match blank where the blank is opaque
                d = np.asarray(Image.open(deco).convert('RGB')).astype(np.float32)
                b = np.asarray(Image.open(blank).convert('RGBA')).astype(np.float32)
                m = b[..., 3] > 250
                diff = np.abs(d[m] - b[..., :3][m]).mean()
                if diff > 12: report.append(f'ALIGN? {p["id"]} {v["name"]} {c["name"]} diff={diff:.1f}')
            name = f'{p["id"]}-{c["id"]}-{v["name"].lower().replace(" ", "")}.webp'
            im.save(f'{OUT}/{name}', 'WEBP', quality=84, method=6)
            files.append({'view': v['name'], 'file': name})
            if c['id'] == p['defaultColor'] or c is p['colors'][0]:
                scores[v['name']] = float(np.mean((on_white(im) - listing) ** 2))
        entry['colors'][str(c['id'])] = files
    entry['primary'] = min(scores, key=scores.get) if scores else None
    entry['scores'] = {k: round(v) for k, v in scores.items()}
    manifest[p['id']] = entry

json.dump(manifest, open('img_manifest.json', 'w'), indent=1)
print('\n'.join(report) or 'no issues')
for pid, e in manifest.items():
    print(pid, e['primary'], e['scores'])
