import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

// vite-plugin-cesium already copies Cesium's Assets/Workers/Widgets into the
// build and sets CESIUM_BASE_URL, so no separate static-copy step is needed.
export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    host: true,
    port: 5173,
  },
});
