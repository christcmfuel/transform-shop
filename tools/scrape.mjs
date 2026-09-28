// Scrape the Transform Fitness DecoNetwork store: product data + all image variants.
import fs from 'node:fs/promises';
import path from 'node:path';

const B = 'https://transformfitness.deco-apparel.com';
const OUT = path.resolve('raw');
await fs.mkdir(OUT, { recursive: true });

const CATS = {
  Headwear: 6316231, 'Bras-Tops': 6321591, 'Vests-Tank-Tops': 6321356, 'T-Shirts': 6316216,
  Sweatshirts: 6321346, Hoodies: 6316221, Shorts: 6321691, Bags: 6321406, 'Gilets-Jackets': 6331606,
};

function extract(html) {
  const i = html.indexOf('initializeDesigner("decorated_product_display"');
  if (i < 0) return null;
  const j = html.indexOf('{"products"', i);
  let depth = 0, k = j, inStr = false, esc = false;
  for (; k < html.length; k++) {
    const ch = html[k];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true; else if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
  }
  return JSON.parse(html.slice(j, k + 1));
}

async function get(url, asBuf = false) {
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(B + url);
      if (!r.ok) return null;
      return asBuf ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  return null;
}

const products = [];
for (const [cat, cid] of Object.entries(CATS)) {
  const html = await get(`/shop/category/${cat}?c=${cid}&page_size=100`);
  const ids = [...new Set([...html.matchAll(/view_product\/(\d+)\/([^"?#]*)/g)].map(m => m[1] + '|' + m[2]))];
  for (const e of ids) {
    const [id, slug] = e.split('|');
    const page = await get(`/shop/view_product/${id}/${slug}`);
    const o = extract(page);
    const pre = o.predecorated_products[0];
    const p = o.products.find(x => x.id === pre.p) || o.products[0];
    const colIds = pre.allColors ? p.c.map(x => x.id) : pre.colors?.length ? pre.colors : [pre.color];
    const colors = colIds.map(c => { const x = p.c.find(y => y.id === c); return { id: c, hex: x?.c?.[0]?.[0], name: x?.c?.[0]?.[1] }; });
    const sizeField = p.f.find(f => f.pt === 2 && f.opts.length);
    const deco = (pre.u || []).map(u => u.id);
    const views = p.v.filter(v => v.viewable && !v.discontinued).map(v => ({ id: v.id, name: v.name, deco: deco.includes(v.id) }));
    products.push({
      id, slug, cat, name: pre.n, code: p.code, brand: p.manufacturer_name, base: p.name, desc: p.desc,
      price: +(pre.m + pre.cp).toFixed(2), colors, defaultColor: pre.color,
      sizes: sizeField ? sizeField.opts.filter(x => !x.dis).map(x => ({ v: x.value, n: x.name, def: !!x.s })) : [],
      views, chart: p.szt || null, weight: p.wt,
    });
    process.stdout.write('.');
  }
}
await fs.writeFile('raw/products.json', JSON.stringify(products, null, 1));
console.log('\nproducts', products.length);

// Images
const jobs = [];
for (const p of products) {
  jobs.push([`/ssc/i/decorated_product_listing_image_quality/${p.id}/600/600/FFFFFF/1/0/product.jpg`, `L_${p.id}.jpg`]);
  for (const c of p.colors) for (const v of p.views) {
    if (v.deco) jobs.push([`/cpimages_n/${p.id}/${v.id}/${c.id}/1/2/0/prod.jpg`, `D_${p.id}_${v.id}_${c.id}.jpg`]);
    jobs.push([`/pcimages/${v.id}/${c.id}/1/2/t/prod.png`, `T_${v.id}_${c.id}.png`]);
  }
}
let done = 0;
const uniq = [...new Map(jobs.map(j => [j[1], j])).values()];
async function worker() {
  while (uniq.length) {
    const [u, f] = uniq.shift();
    const fp = path.join(OUT, f);
    try { await fs.access(fp); done++; continue; } catch {}
    const buf = await get(u, true);
    if (buf) await fs.writeFile(fp, buf);
    else console.log('\nMISS', u);
    done++;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log('images', done);
