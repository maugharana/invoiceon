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

// Both ports can be overridden (PORT for the page, INVOICEON_BRIDGE_PORT for the data layer) so several previews can run side by side.
// scripts/dev-web.mjs sets INVOICEON_BRIDGE_PORT for the data layer and for this proxy alike.
const WEB_PORT = Number(process.env.PORT) || 5173;
const BRIDGE_PORT = Number(process.env.INVOICEON_BRIDGE_PORT) || 5199; // keep the default in sync with electron/bridge.ts

export default defineConfig({
  plugins: [react(), productionCsp()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: WEB_PORT,
    strictPort: true,
    // Browser-only dev mode (npm run dev:web): the renderer talks to the SQLite bridge over HTTP.
    proxy: { '/rpc': `http://127.0.0.1:${BRIDGE_PORT}` },
  },
});
