/**
 * Bakes deployable web assets from the heavy source art in `assets/`.
 *
 *   npm run assets
 *
 * Only the baked output lands in `Public/`, which is what gets deployed. The
 * sources stay in the repo but out of the bundle — they're ~90MB of 2–3MB
 * stills that only ever cover a few hundred pixels on screen.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { POSTERS } from '../src/config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcImages = path.join(root, 'assets', 'images');
const outPosters = path.join(root, 'Public', 'posters');
const outBrand = path.join(root, 'Public', 'brand');

const kb = (n) => `${Math.round(n / 1024)} KB`;

/* ------------------------------------------------------------- posters -- */

await fs.mkdir(outPosters, { recursive: true });
let total = 0;
for (let i = 0; i < POSTERS.length; i++) {
  const out = path.join(outPosters, `poster-${String(i).padStart(2, '0')}.webp`);
  await sharp(path.join(srcImages, POSTERS[i]))
    .resize(640, 640, { fit: 'cover', position: 'attention' })
    .webp({ quality: 82 })
    .toFile(out);
  total += (await fs.stat(out)).size;
}
console.log(`posters: ${POSTERS.length} files, ${kb(total)}`);

/* ---------------------------------------------------------------- logo -- */

await fs.mkdir(outBrand, { recursive: true });
const logoSrc = path.join(root, 'assets', 'thuggermon-logo.png');

// The source has a lot of empty margin; trim it so the wordmark can be
// positioned by its actual ink rather than by transparent padding.
const trimmed = await sharp(logoSrc).trim().toBuffer();
const meta = await sharp(trimmed).metadata();

await sharp(trimmed).resize({ width: 1100 }).webp({ quality: 92 }).toFile(path.join(outBrand, 'logo.webp'));
await sharp(trimmed).resize({ width: 1100 }).png({ compressionLevel: 9 }).toFile(path.join(outBrand, 'logo.png'));

// Favicon: the wordmark is far too wide to read as a square, so crop the
// leading glyphs — that reads at 16px where the full lockup would not.
await sharp(trimmed)
  .extract({ left: 0, top: 0, width: meta.height, height: meta.height })
  .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(outBrand, 'favicon.png'));

for (const f of ['logo.webp', 'logo.png', 'favicon.png']) {
  console.log(`brand/${f}: ${kb((await fs.stat(path.join(outBrand, f))).size)}`);
}
console.log(`logo trimmed to ${meta.width}x${meta.height}`);
