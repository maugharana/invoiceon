// Shared esbuild settings for the Electron main + preload processes (the renderer is built by Vite).
import { context } from 'esbuild';

export const electronBuildOptions = {
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24', // Electron 44 embeds Node 24
  format: 'cjs',
  external: ['electron', 'electron-updater'],
  sourcemap: true,
  logLevel: 'info',
};

export const watchElectron = (onRebuild) =>
  context({
    ...electronBuildOptions,
    plugins: [{ name: 'on-rebuild', setup: (b) => b.onEnd((r) => r.errors.length === 0 && onRebuild()) }],
  });
