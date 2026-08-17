/**
 * The source images in Public/images are 1.5–3 MB each. As club-wall textures
 * they only ever cover a few hundred pixels, so we bake square 640px webp
 * copies into Public/posters/ and load those instead.
 *
 *   node scripts/build-posters.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { POSTERS } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'Public', 'images');
const outDir = path.join(root, 'Public', 'posters');

await fs.mkdir(outDir, { recursive: true });

let total = 0;
for (let i = 0; i < POSTERS.length; i++) {
  const src = path.join(srcDir, POSTERS[i]);
  const out = path.join(outDir, `poster-${String(i).padStart(2, '0')}.webp`);
  await sharp(src)
    .resize(640, 640, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toFile(out);
  const { size } = await fs.stat(out);
  total += size;
  console.log(`${path.basename(out)}  <-  ${POSTERS[i]}  (${Math.round(size / 1024)} KB)`);
}
console.log(`\n${POSTERS.length} posters, ${Math.round(total / 1024)} KB total.`);
