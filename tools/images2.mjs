// Fetch the correctly-rendered 600px decorated views + matching transparent blanks.
import fs from 'node:fs/promises';
import path from 'node:path';

const B = 'https://transformfitness.deco-apparel.com';
const OUT = path.resolve('raw600');
await fs.mkdir(OUT, { recursive: true });
const products = JSON.parse(await fs.readFile('raw/products.json', 'utf8'));

const jobs = [];
for (const p of products) {
  jobs.push([`/ssc/i/decorated_product_listing_image_quality/${p.id}/600/600/t/1/0/product.png`, `L_${p.id}.png`]);
  for (const c of p.colors) for (const v of p.views) {
    if (v.deco) jobs.push([`/cpimages_n/${p.id}/${v.id}/${c.id}/12/1/0/prod.jpg`, `D_${p.id}_${v.id}_${c.id}.jpg`]);
    jobs.push([`/pcimages/${v.id}/${c.id}/12/1/t/prod.png`, `T_${v.id}_${c.id}.png`]);
  }
}
const queue = [...new Map(jobs.map(j => [j[1], j])).values()];
let n = 0;
async function worker() {
  while (queue.length) {
    const [u, f] = queue.shift();
    const fp = path.join(OUT, f);
    try { await fs.access(fp); n++; continue; } catch {}
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(B + u);
        if (r.ok) { await fs.writeFile(fp, Buffer.from(await r.arrayBuffer())); break; }
        console.log('HTTP', r.status, u); break;
      } catch { await new Promise(r => setTimeout(r, 700)); }
    }
    n++;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log('done', n);
