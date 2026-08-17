import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * Dev-only: lets the running page POST a rendered frame to disk, so the intro
 * and the rig can be tuned by looking at exact moments on the timeline instead
 * of guessing. Never included in a build.
 */
function frameGrabber(outDir) {
  return {
    name: 'frame-grabber',
    apply: 'serve',
    configureServer(server) {
      fs.mkdirSync(outDir, { recursive: true });
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') return res.end('post only');
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const [meta, data] = body.split(',');
          const ext = /png/.test(meta) ? 'png' : 'jpg';
          const name = (req.url.replace(/^\//, '') || 'frame') + '.' + ext;
          fs.writeFileSync(path.join(outDir, name), Buffer.from(data, 'base64'));
          res.end(name);
        });
      });
    },
  };
}

const SHOT_DIR = path.resolve(process.cwd(), '.shots');

export default defineConfig({
  // The assets folder in this repo is capitalised.
  publicDir: 'Public',
  server: { host: true, open: true },
  build: { target: 'es2020', assetsInlineLimit: 0 },
  plugins: [frameGrabber(SHOT_DIR)],
});
