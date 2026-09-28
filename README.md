# Transform Fitness Kit — shop.tcmfuel.com

The kit store for Transform Fitness Plymouth, The People's Gym. Plain static
HTML/CSS/JS, no build step. Served by **GitHub Pages** from `main` at
**https://shop.tcmfuel.com** (custom domain set by `CNAME`).

Run it locally:

```bash
npx http-server . -p 8080
```

## How it's put together

- `index.html` — page shell and all CSS (light and dark themes).
- `app.js` — the store: home, shop with filters, product pages, size guides and
  fit finder, race-kit builder, bag, checkout, orders, saved items. Preact + htm
  (vendored in `vendor/`), hash routing (`#shop-tees`, `#p-classic-hoodie`, …).
  Bag, saved items and orders are kept in the visitor's browser (localStorage).
- `catalog.js` — generated product data. `img/` — generated product cut-outs.
- `brand/` — logo masks (recoloured in CSS), hero photo, rubber-floor texture.

## Checkout is preview-only

No payments are taken and orders aren't sent anywhere. The confirmation page
links each item to the current DecoNetwork store
(https://transformfitness.deco-apparel.com) so people can order it today.
`index.html` carries `noindex` until checkout is real — remove it then.

Delivery settings live at the top of `app.js` (`FREE_DELIVERY_OVER`,
`DELIVERY_FEE`).

## Refreshing the catalogue from the DecoNetwork store

Product names, pitches and groupings are curated in `tools/families.py`;
prices, colours, sizes, size charts, fabric specs and photos are scraped.

```bash
cd tools
node scrape.mjs          # product data + images from the Deco store -> raw/
node images2.mjs         # correctly rendered 600px views + transparent blanks -> raw600/
python cutout.py         # transparent cut-outs -> cut/  (needs numpy + Pillow)
python build_catalog.py  # writes ../catalog.js and ../img/
```

Deco's 800px renders place logos wrongly; the tools use the 600px renders
(`/12/1/0`) masked with the blank garment's transparent PNG instead.
A new Deco listing needs an entry in `tools/families.py` before it shows up.
