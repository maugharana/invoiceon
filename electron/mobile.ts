import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { todayIso } from '../shared/gst';
import { matchesAll } from '../shared/search';
import type { MobileStatus } from '../shared/mobile';
import { all, run, type Db } from './db/connection';
import { UserError } from './services/common';
import { inventorySummary } from './services/inventory';
import { dashboardSummary, listInvoices, variantsForSale } from './services/invoices';
import { duesReport, paymentsSummary } from './services/receivables';
import { getSettings } from './services/settings';
import { MOBILE_PAGE } from './mobilePage';

// The phone view: a small, read only web page the shop computer serves on the local network, so the owner can check today's sales, who owes
// what and what is in stock from a phone on the same Wi-Fi. It is off until switched on, it answers only to a long random link, and it can
// only read a fixed handful of safe figures: nothing it serves can change a record, and no costs or profit are ever sent.

const DEFAULT_PORT = 5757;
const TOKEN_BYTES = 16;
const PAGE = /^\/m\/([0-9a-f]{32})\/?$/;
const DATA = /^\/m\/([0-9a-f]{32})\/data\/(summary|dues|stock|invoices)$/;

const setting = (db: Db, key: string): string | undefined => all<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)[0]?.value;
const put = (db: Db, key: string, value: string) =>
  run(db, 'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, value, new Date().toISOString());

// ── What the phone may see ──────────────────────────────────────────────────
export function mobileSummary(db: Db) {
  const today = todayIso();
  const dash = dashboardSummary(db);
  const sold = listInvoices(db).filter((i) => i.issueDate === today && i.status !== 'cancelled');
  const inv = inventorySummary(db);
  const pay = paymentsSummary(db);
  return {
    businessName: getSettings(db).businessName,
    asOf: today,
    today: { invoices: sold.length, invoicedPaise: sold.reduce((s, i) => s + i.totalPaise, 0) },
    month: { invoices: dash.monthInvoices, invoicedPaise: dash.monthPaise, receivedPaise: pay.receivedThisMonthPaise },
    outstandingPaise: dash.outstandingPaise,
    overdueCount: dash.overdueCount,
    overduePaise: dash.overduePaise,
    unitsInStock: inv.unitsInStock,
    lowStockDesigns: inv.lowStockDesigns,
    outOfStockDesigns: inv.outOfStockDesigns,
  };
}

export function mobileDues(db: Db) {
  return duesReport(db)
    .rows.filter((r) => r.outstandingPaise > 0)
    .sort((a, b) => b.outstandingPaise - a.outstandingPaise)
    .slice(0, 60)
    .map((r) => ({ name: r.customerName, phone: r.phone, openInvoices: r.openInvoices, outstandingPaise: r.outstandingPaise, overduePaise: r.overduePaise, oldestDueDate: r.oldestDueDate }));
}

export function mobileStock(db: Db, query: string) {
  return variantsForSale(db)
    .filter((v) => matchesAll(`${v.sku} ${v.designName} ${v.designCode} ${v.color} ${v.size}`, query))
    .slice(0, 40)
    .map((v) => ({ sku: v.sku, designName: v.designName, designCode: v.designCode, color: v.color, size: v.size, stock: v.stock, sellPricePaise: v.sellPricePaise, mrpPaise: v.mrpPaise }));
}

export function mobileInvoices(db: Db) {
  return listInvoices(db)
    .slice(0, 30)
    .map((i) => ({ number: i.number, buyerName: i.buyerName, issueDate: i.issueDate, totalPaise: i.totalPaise, paidPaise: i.paidPaise, status: i.status }));
}

// ── The server ──────────────────────────────────────────────────────────────
export interface MobileController {
  status(): MobileStatus;
  /** Starts serving (and remembers to, next time the app opens). */
  enable(): Promise<MobileStatus>;
  disable(): Promise<MobileStatus>;
  /** A new link. Any phone that had the old one stops working. */
  resetLink(): Promise<MobileStatus>;
  /** At startup: serve again if it was switched on. Never throws. */
  resume(): Promise<void>;
  stop(): Promise<void>;
}

const controllers = new WeakMap<Db, MobileController>();

/** One controller per database. The options only matter the first time (tests use a random local port). */
export function mobileController(db: Db, options: { port?: number; host?: string } = {}): MobileController {
  const existing = controllers.get(db);
  if (existing) return existing;
  const made = createController(db, options);
  controllers.set(db, made);
  return made;
}

const lanAddresses = (): string[] =>
  Object.values(networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((n) => n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function createController(db: Db, options: { port?: number; host?: string }): MobileController {
  const host = options.host ?? '0.0.0.0';
  const preferred = options.port ?? DEFAULT_PORT;
  let server: Server | null = null;
  let port: number | null = null;
  let error: string | null = null;
  // Someone guessing links gets a few tries a minute, not thousands.
  const misses = new Map<string, { count: number; resetAt: number }>();

  const send = (res: ServerResponse, code: number, body: string, type = 'application/json; charset=utf-8', extra: Record<string, string> = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end(body);
  };

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const ip = req.socket.remoteAddress ?? '?';
    const url = new URL(req.url ?? '/', 'http://x');
    const token = setting(db, 'mobile_token') ?? '';
    const page = PAGE.exec(url.pathname);
    const data = DATA.exec(url.pathname);
    const offered = page?.[1] ?? data?.[1];

    if (req.method !== 'GET' || !offered) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    if (!token || !sameToken(offered, token)) {
      // The right link is never turned away; only guessing is slowed.
      const miss = misses.get(ip);
      const fresh = miss && miss.resetAt > Date.now() ? miss : { count: 0, resetAt: Date.now() + 60_000 };
      fresh.count += 1;
      misses.set(ip, fresh);
      if (fresh.count > 20) return send(res, 429, 'Too many tries. Wait a minute.', 'text/plain; charset=utf-8');
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }

    try {
      if (page) {
        if (!url.pathname.endsWith('/')) return void res.writeHead(302, { Location: `${url.pathname}/` }).end();
        const nonce = randomBytes(16).toString('base64');
        return send(res, 200, MOBILE_PAGE.replaceAll('__NONCE__', nonce), 'text/html; charset=utf-8', {
          'Content-Security-Policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        });
      }
      const what = data![2];
      const body = what === 'summary' ? mobileSummary(db) : what === 'dues' ? mobileDues(db) : what === 'stock' ? mobileStock(db, (url.searchParams.get('q') ?? '').slice(0, 60)) : mobileInvoices(db);
      return send(res, 200, JSON.stringify(body));
    } catch (err) {
      console.error('[mobile] request failed', err);
      return send(res, 500, JSON.stringify({ error: 'Something went wrong.' }));
    }
  }

  const listen = (p: number) =>
    new Promise<Server>((resolve, reject) => {
      const s = createServer(handle);
      s.once('error', reject);
      s.listen(p, host, () => {
        s.off('error', reject);
        resolve(s);
      });
    });

  async function start(): Promise<void> {
    if (server) return;
    error = null;
    // The usual port if it is free, then the next few, then whatever the system gives.
    for (const candidate of preferred === 0 ? [0] : [preferred, ...Array.from({ length: 10 }, (_, i) => preferred + 1 + i), 0]) {
      try {
        server = await listen(candidate);
        const address = server.address();
        port = typeof address === 'object' && address ? address.port : candidate;
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
          error = `The phone view could not start: ${(err as Error).message}`;
          return;
        }
      }
    }
    error = 'The phone view could not find a free port.';
  }

  async function halt(): Promise<void> {
    const s = server;
    server = null;
    port = null;
    if (!s) return;
    s.closeAllConnections();
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  const status = (): MobileStatus => {
    const enabled = setting(db, 'mobile_enabled') === '1';
    const token = setting(db, 'mobile_token');
    const running = !!server && port !== null;
    const addresses = host === '0.0.0.0' ? lanAddresses() : [host];
    return { enabled, running, port, error, urls: running && token ? addresses.map((a) => `http://${a}:${port}/m/${token}/`) : [] };
  };

  return {
    status,
    async enable() {
      if (!setting(db, 'mobile_token')) put(db, 'mobile_token', randomBytes(TOKEN_BYTES).toString('hex'));
      put(db, 'mobile_enabled', '1');
      await start();
      if (!server) {
        put(db, 'mobile_enabled', '0');
        throw new UserError(error ?? 'The phone view could not start.');
      }
      return status();
    },
    async disable() {
      put(db, 'mobile_enabled', '0');
      await halt();
      return status();
    },
    async resetLink() {
      put(db, 'mobile_token', randomBytes(TOKEN_BYTES).toString('hex'));
      return status();
    },
    async resume() {
      try {
        if (setting(db, 'mobile_enabled') === '1') await start();
      } catch (err) {
        console.error('[mobile] could not resume', err);
      }
    },
    stop: halt,
  };
}
