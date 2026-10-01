// DEV ONLY (npm run dev:web / npm run demo). Serves the same data layer the desktop app uses over local HTTP, so the UI
// can be developed and tested in a plain browser tab against a real SQLite file. Never packaged.
//
//   INVOICEON_DB_DIR   where the database lives (default .dev-data)
//   INVOICEON_FRESH=1  start from an empty database, discarding what was there
//   INVOICEON_DEMO=1   if the database is empty, fill it with sample data
//   INVOICEON_BRIDGE_PORT  the port to listen on (default 5199)
import { mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { createApi, invoke } from './api';
import { openDb } from './db/connection';
import { listDesigns } from './services/inventory';
import { loadSampleData } from './services/seed';

const PORT = Number(process.env.INVOICEON_BRIDGE_PORT) || 5199;
const dir = resolve(process.env.INVOICEON_DB_DIR ?? join(process.cwd(), '.dev-data'));
mkdirSync(dir, { recursive: true });

if (process.env.INVOICEON_FRESH === '1') {
  for (const f of ['invoiceon.db', 'invoiceon.db-wal', 'invoiceon.db-shm']) rmSync(join(dir, f), { force: true });
}
const db = openDb(join(dir, 'invoiceon.db'));
if (process.env.INVOICEON_DEMO === '1' && listDesigns(db).length === 0) {
  loadSampleData(db);
  console.log('[bridge] demo: sample data loaded');
}
const api = createApi(db, undefined, dir);

createServer((req, res) => {
  const method = /^\/rpc\/([A-Za-z]+)$/.exec(req.url ?? '')?.[1];
  if (req.method !== 'POST' || !method) {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    let args: unknown[] = [];
    try {
      args = (JSON.parse(body || '{}') as { args?: unknown[] }).args ?? [];
    } catch {
      /* fall through with no args */
    }
    const envelope = await invoke(api, method, args);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(envelope));
  });
}).listen(PORT, '127.0.0.1', () => console.log(`[bridge] data layer on http://127.0.0.1:${PORT}  (db: ${dir})`));
