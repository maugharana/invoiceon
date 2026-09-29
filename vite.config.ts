import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Locks the packaged renderer down. Not applied in dev, where Vite needs inline scripts for HMR.
const productionCsp = (): Plugin => ({
  name: 'invoiceon-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'",
      },
      injectTo: 'head-prepend',
    },
  ],
});

const BRIDGE_PORT = 5199; // keep in sync with electron/bridge.ts

export default defineConfig({
  plugins: [react(), productionCsp()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    // Browser-only dev mode (npm run dev:web): the renderer talks to the SQLite bridge over HTTP.
    proxy: { '/rpc': `http://127.0.0.1:${BRIDGE_PORT}` },
  },
});
