// npm run dev — Vite dev server for the UI + esbuild watch for the main process + Electron, restarted on main-process changes.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { watchElectron } from './electron-build.mjs';

const electronPath = createRequire(import.meta.url)('electron');

const vite = await createServer({ configFile: 'vite.config.ts' });
await vite.listen();
const url = vite.resolvedUrls.local[0];

let child = null;
let quitting = false;
const launch = () => {
  child = spawn(electronPath, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
  child.on('exit', () => {
    if (child?.restarting) return;
    if (!quitting) shutdown();
  });
};
const restart = () => {
  if (!child) return launch();
  const old = child;
  old.restarting = true;
  old.once('exit', launch);
  old.kill();
};

const watcher = await watchElectron(restart);
await watcher.watch();

async function shutdown() {
  quitting = true;
  child?.kill();
  await watcher.dispose();
  await vite.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
