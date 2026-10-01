// npm run dev:web — the UI in a normal browser tab, backed by the real data layer over local HTTP (see electron/bridge.ts).
// npm run demo    — the same, but on a fresh throwaway database filled with sample data, and it opens your browser.
// Handy for UI work and for looking around; the desktop app itself uses IPC instead.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { build } from 'esbuild';
import { createServer } from 'vite';

const demo = process.argv.includes('--demo');

// Normally the page is on 5173 and the data layer on 5199. When a tool hands us a port (PORT), several previews can be running
// at once, so the data layer takes any free port too. vite.config.ts and the bridge both read INVOICEON_BRIDGE_PORT.
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
if (process.env.PORT && !process.env.INVOICEON_BRIDGE_PORT) process.env.INVOICEON_BRIDGE_PORT = String(await freePort());
const bridgePort = Number(process.env.INVOICEON_BRIDGE_PORT) || 5199;

mkdirSync('.dev-data', { recursive: true });
await build({
  entryPoints: ['electron/bridge.ts'],
  outfile: '.dev-data/bridge.cjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  logLevel: 'warning',
});

// The demo database is its own file, rebuilt every run, so it can never touch anything you've entered in dev:web.
// A preview started with an assigned port may be running beside another demo, which has its database open, so it gets its own folder.
const demoDir = process.env.PORT ? `.dev-data/demo-${process.env.PORT}` : '.dev-data/demo';
const env = demo ? { ...process.env, INVOICEON_DEMO: '1', INVOICEON_FRESH: '1', INVOICEON_DB_DIR: demoDir } : process.env;
const bridge = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '.dev-data/bridge.cjs'], { stdio: 'inherit', env });

const vite = await createServer({ configFile: 'vite.config.ts' });
await vite.listen();
const url = vite.resolvedUrls?.local[0] ?? 'http://localhost:5173/';

// Don't announce (or open a browser) until the data layer is really answering, or the first screen would show an error.
async function waitForBridge() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/rpc/getSettings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"args":[]}' });
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

if (await waitForBridge()) {
  console.log(`\n  InvoiceOn ${demo ? 'demo' : 'preview'} is ready:  ${url}\n${demo ? '  (sample data, rebuilt on every start — nothing here is saved to your real data)\n' : ''}  Press Ctrl+C to stop.\n`);
  if (demo && !process.argv.includes('--no-open')) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  }
} else {
  console.error('\n  The data layer did not start. Check the messages above.\n');
}

const shutdown = async () => {
  bridge.kill();
  await vite.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
bridge.on('exit', shutdown);
