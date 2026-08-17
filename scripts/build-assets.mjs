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

/**
 * Favicon. The wordmark is 3:1, so any square crop of it is either a couple of
 * letters or a lot of empty space — it never sits right in a tab. A character
 * portrait does: at 16px you read the silhouette and the colour, which is all a
 * favicon ever gets to say.
 *
 * Crop is in source pixels against a 1600x900 still, framed on the head so the
 * ears and cheeks survive the downscale.
 */
const FAVICON = {
  src: path.join(srcImages, 'pikadigley.png'),
  crop: { left: 660, top: 135, width: 500, height: 500 },
};

for (const [name, size] of [
  ['favicon.png', 256],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(FAVICON.src)
    .extract(FAVICON.crop)
    .resize(size, size, { fit: 'cover' })
    // small sizes lose the ear tips and cheek edges without a nudge
    .sharpen({ sigma: 0.8 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(outBrand, name));
}

/**
 * Share card. Social scrapers want a fixed 1.91:1 image — handing them the bare
 * wordmark (3:1, transparent) gets letterboxed against whatever background the
 * client picks, which for a transparent PNG is often white. So compose it onto
 * the club's own background at the exact size X and friends expect.
 */
const OG_W = 1200;
const OG_H = 630;
const logoOnCard = await sharp(trimmed).resize({ width: 940 }).toBuffer();
const logoMeta = await sharp(logoOnCard).metadata();

await sharp({
  create: { width: OG_W, height: OG_H, channels: 4, background: { r: 10, g: 6, b: 22, alpha: 1 } },
})
  .composite([
    { input: logoOnCard, left: Math.round((OG_W - logoMeta.width) / 2), top: Math.round((OG_H - logoMeta.height) / 2) },
  ])
  .png({ compressionLevel: 9 })
  .toFile(path.join(outBrand, 'og.png'));

for (const f of ['logo.webp', 'logo.png', 'favicon.png', 'apple-touch-icon.png', 'og.png']) {
  console.log(`brand/${f}: ${kb((await fs.stat(path.join(outBrand, f))).size)}`);
}
console.log(`logo trimmed to ${meta.width}x${meta.height}`);
