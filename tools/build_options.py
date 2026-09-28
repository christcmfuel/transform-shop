"""Generate options/<name>/index.html for each design option.

Every option shares app.js, catalog.js, the images and css/store.css; it adds
its own theme.css (token + layout overrides) and site.js (window.TF_SITE:
hero copy/media, gallery). This writes the HTML shell so the head stays
consistent. Run from the repo root:  python tools/build_options.py
"""
import os

DESC = "Official kit of Transform Fitness Plymouth, The People's Gym. Tees, hoodies, vests, shorts and bags with the Transform Fitness mark, printed and embroidered to order."

# name -> (title, one-line pitch for the options index, Google Fonts query)
OPTIONS = {
    "chalk": (
        "Chalk",
        "Light and editorial. Serif headlines, warm chalk paper, real photos framed like a lookbook.",
        "family=Instrument+Serif:ital@0;1&family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500;600",
    ),
    "blackout": (
        "Blackout",
        "Dark and loud. Video hero from the gym floor, stencil type, neon green, ticker running.",
        "family=Big+Shoulders+Stencil+Display:wght@800;900&family=Big+Shoulders+Display:wght@700;800;900&family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500;600",
    ),
    "field": (
        "Field",
        "Olive and utilitarian. Kit-list grids, spec labels, stamps. Built around the olive tees and MOLLE bags.",
        "family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600",
    ),
    "people": (
        "People",
        "Warm and community-first. Members' photos everywhere, soft corners, the gym dog in the footer.",
        "family=Outfit:wght@500;600;700;800&family=Archivo:wdth,wght@75..125,400..700&family=IBM+Plex+Mono:wght@400;500;600",
    ),
}

TEMPLATE = """<!doctype html>
<html lang="en-GB" data-variant="{name}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Transform Fitness Kit · {title}</title>
<meta name="description" content="{desc}">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0B0D0C">
<link rel="icon" href="/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="canonical" href="https://shop.tcmfuel.com/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Transform Fitness Kit">
<meta property="og:title" content="Transform Fitness Kit · {title} option">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="https://shop.tcmfuel.com/og.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{fonts}&display=swap">
<link rel="stylesheet" href="/css/store.css?v={v}">
<link rel="stylesheet" href="theme.css?v={v}">
<script>window.TF_ASSET_BASE = '/';</script>
<script src="site.js?v={v}"></script>
</head>
<body>
<a class="opt-back" href="/options/">Options</a>
<div id="app"></div>
<noscript><p style="padding:24px">The Transform Fitness kit store needs JavaScript to run.</p></noscript>
<script src="/vendor/htm-preact-3.1.1.umd.js"></script>
<script src="/catalog.js?v={v}"></script>
<script src="/app.js?v={v}"></script>
</body>
</html>
"""

V = "20260929b"
root = os.path.join(os.path.dirname(__file__), "..")
for name, (title, _pitch, fonts) in OPTIONS.items():
    d = os.path.join(root, "options", name)
    if not os.path.isdir(d):
        print("skip", name, "(no folder yet)")
        continue
    with open(os.path.join(d, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(TEMPLATE.format(name=name, title=title, desc=DESC, fonts=fonts, v=V))
    print("wrote options/%s/index.html" % name)
