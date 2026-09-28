import html, json, re, shutil, os
from families import FAMILIES, CATEGORIES

B = 'https://transformfitness.deco-apparel.com'
P = {p['id']: p for p in json.load(open('raw/products.json'))}
M = json.load(open('img_manifest.json'))
LOGO = {'green': '#35d24f', 'silver': '#c9cdc8', 'black': '#0c0d0c', 'none': None}

def colour_family(name):
    n = name.lower()
    if 'camo' in n or 'multicam' in n: return 'Camo'
    if 'black' in n: return 'Black'
    if 'lime' in n: return 'Lime'
    return 'Green'

def parse_chart(szt):
    if not szt: return None
    rows = []
    for r in re.findall(r'<tr[^>]*>(.*?)</tr>', szt, re.S):
        cells = [html.unescape(re.sub('<[^>]+>', '', c)).strip() for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', r, re.S)]
        if cells and cells not in rows: rows.append(cells)
    head = rows[0]
    body = [r for r in rows[1:] if r[0].lower() != 'size']
    labels = [r[0] for r in body]
    if any('dimension' in l.lower() or 'embroidery' in l.lower() or 'print area' in l.lower() for l in labels) or head[1:] == ['One']:
        return {'type': 'dims', 'rows': [r for r in body if r[0].lower() == 'dimensions']} if any(r[0].lower() == 'dimensions' for r in body) else None
    kind = 'fit' if any('to fit' in l.lower() for l in labels) else 'garment'
    return {'type': kind, 'sizes': head[1:], 'rows': body}

def clean_size(v):
    return 'One size' if v == 'One' else v

products = []
for fam in FAMILIES:
    first = P[fam['variants'][0][0]]
    variants = []
    for deco_id, label, _, logo in fam['variants']:
        p = P[deco_id]
        man = M[deco_id]
        for c in p['colors']:
            files = man['colors'][str(c['id'])]
            order = sorted(files, key=lambda f: f['view'] != man['primary'])
            variants.append({
                'id': f'{deco_id}-{c["id"]}',
                'deco': deco_id,
                'label': label or c['name'],
                'colour': c['name'].replace(' Tri Blend', '').replace('Solid ', ''),
                'hex': c['hex'],
                'family': colour_family(c['name']),
                'logo': logo,
                'logoHex': LOGO[logo],
                'price': p['price'],
                'images': [{'view': f['view'], 'src': 'img/' + f['file']} for f in order],
                'url': f'{B}/shop/view_product/{deco_id}/{p["slug"]}',
            })
    sizes = [clean_size(s['v']) for s in first['sizes'] if s['v'] != 'MS']
    products.append({
        'slug': fam['slug'], 'name': fam['name'], 'cat': fam['cat'], 'code': first['code'],
        'brand': html.unescape(first['brand'] or ''), 'base': html.unescape(first['base']),
        'pitch': fam['pitch'], 'prints': fam['prints'], 'features': fam['features'],
        'featured': fam['featured'], 'sizes': sizes, 'chart': parse_chart(first['chart']),
        'variants': variants,
    })

gym = {
    'name': 'Transform Fitness Plymouth', 'tagline': "The People's Gym",
    'address': '9B Meadow Close, Plympton, Plymouth PL7 5EX', 'phone': '01752 427413',
    'email': 'info@transformgyms.uk', 'instagram': '@transformfitnessplymouth',
    'legacyStore': B + '/',
}
cats = [{'slug': s, 'label': l, 'blurb': b} for s, l, b in CATEGORIES]
data = {'categories': cats, 'products': products, 'gym': gym}
compact = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
with open('../catalog.js', 'w', encoding='utf-8', newline='\n') as f:
    f.write('// Transform Fitness kit catalogue, built from the live DecoNetwork store.\n')
    f.write('window.TF_CATALOG = ' + compact + ';\n')
# Plain-JSON twin: the Hub API prices every checkout from this file.
with open('../catalog.json', 'w', encoding='utf-8', newline='\n') as f:
    f.write(compact)

# copy only the images the catalogue references
os.makedirs('../img', exist_ok=True)
used = {i['src'] for p in products for v in p['variants'] for i in v['images']}
for s in used: shutil.copy('cut/' + s[len('img/'):], '../' + s)
print(len(products), 'families,', sum(len(p['variants']) for p in products), 'variants,', len(used), 'images')
for p in products:
    print(f"{p['slug']:22} {p['cat']:9} sizes={','.join(p['sizes'])} chart={p['chart']['type'] if p['chart'] else None} "
          f"variants={[ (v['label'], v['colour'], v['price'], len(v['images'])) for v in p['variants']]}")
