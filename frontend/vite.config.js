import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cesium(), viteStaticCopy({
    targets: [{
      src: 'node_modules/cesium/Build/Cesium',
      dest: ''
    }]
  })],
})
