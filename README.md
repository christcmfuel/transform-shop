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

## Design options

`/options/` holds alternative looks for the same store: Chalk, Blackout, Field,
People. Each is `options/<name>/theme.css` (token and layout overrides on top
of `css/store.css`) plus `options/<name>/site.js` (`window.TF_SITE`: hero
copy/media, ticker switch, photo gallery). `tools/build_options.py` writes each
option's `index.html`; `options/index.html` compares them with live previews.
Real gym photos live in `brand/photos/`. To promote an option to the live
store, copy its theme rules into `css/store.css` and its `TF_SITE` settings
into a `<script>` in `index.html`.

## Payments

Checkout hands off to Stripe through the Transform Hub API
(`https://app.tcmfuel.com/api/shop/...`, source in the `transform-hub` repo,
`crm/server/src/shop.ts`). On load the store asks `/api/shop/config`; when
Stripe is on, the "Pay by card" flow runs and the thank-you page shows live
order status. When the API is off or unreachable the store falls back to a
request-only checkout that links each item to the old DecoNetwork store
(https://transformfitness.deco-apparel.com). The API prices every checkout
from this repo's `catalog.json`, never from the browser.

`index.html` carries `noindex` until payments are live. Remove it then.
Delivery terms (£4.95, free over £60) are set in the API and mirrored at the
top of `app.js`.

## Checkout fallback (no payments)

When the API reports card payments are off, orders are only kept in the
visitor's browser and the confirmation page links each item to the current
DecoNetwork store so people can order it today.

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
