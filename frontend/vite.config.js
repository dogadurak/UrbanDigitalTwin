import fs from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// A GitHub Pages project site is served from https://<user>.github.io/<repo>/,
// so every asset URL needs that prefix. The deploy workflow passes it; a local
// build or `npm run dev` serves from the root and needs nothing.
const base = process.env.BASE_PATH || '/';

/**
 * Put Cesium's runtime assets where the page actually asks for them.
 *
 * `vite-plugin-cesium` sets `CESIUM_BASE_URL` to `join(base, 'cesium/')` -- a
 * URL -- and then copies the Assets, Workers, Widgets and ThirdParty
 * directories to `join(outDir, CESIUM_BASE_URL)`, using that URL as a
 * filesystem path. With `base: '/'` the two coincide and the bug is invisible,
 * which is why it is still there.
 *
 * On a project site they do not coincide. The files land in
 * `dist/<repo>/cesium/` while `index.html` requests `/<repo>/cesium/...`, which
 * Pages resolves to `dist/cesium/...`. Every worker and every widget 404s and
 * the globe never renders -- with no build error to warn anyone.
 *
 * So: move them, and then check. The check is the more important half. A
 * dashboard whose central map is blank should not be publishable.
 */
function placeCesiumAssets() {
  let outDir = 'dist';
  return {
    name: 'place-cesium-assets',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      handler() {
        const wanted = path.join(outDir, 'cesium');

        if (base !== '/') {
          // `path.join` drops the leading slash of a non-first argument, so
          // this reproduces the plugin's own destination exactly.
          const stray = path.join(outDir, base, 'cesium');
          if (fs.existsSync(stray)) {
            fs.rmSync(wanted, { recursive: true, force: true });
            fs.renameSync(stray, wanted);

            // Tidy the empty directories the detour left behind, and stop at
            // the first that still holds something.
            let dir = path.join(outDir, base);
            while (dir !== outDir && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
              fs.rmdirSync(dir);
              dir = path.dirname(dir);
            }
          }
        }

        for (const required of ['Cesium.js', 'Widgets/widgets.css', 'Workers']) {
          if (!fs.existsSync(path.join(wanted, required))) {
            throw new Error(
              `Cesium asset missing from the build: cesium/${required}. The map ` +
              'would render blank. If vite-plugin-cesium changed where it ' +
              'copies its assets, update placeCesiumAssets() in vite.config.js.',
            );
          }
        }
      },
    },
  };
}

// vite-plugin-cesium already sets CESIUM_BASE_URL and pulls Cesium's
// Assets/Workers/Widgets into the build; placeCesiumAssets fixes up where.
export default defineConfig({
  base,
  plugins: [react(), cesium(), placeCesiumAssets()],
  server: {
    host: true,
    port: 5173,
  },
});
