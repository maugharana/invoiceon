import { LOCKED_MESSAGE } from '../../shared/access';
import type { Api, Envelope } from '../../shared/api';

declare global {
  interface Window {
    /** Present only inside the Electron app (see electron/preload.ts). */
    invoiceon?: { invoke(method: string, args: unknown[]): Promise<Envelope> };
  }
}

async function transport(method: string, args: unknown[]): Promise<Envelope> {
  if (window.invoiceon) return window.invoiceon.invoke(method, args);
  // Browser dev mode: the SQLite bridge (npm run dev:web).
  try {
    const res = await fetch(`/rpc/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    return (await res.json()) as Envelope;
  } catch {
    return { ok: false, error: 'Could not reach the local database. Is the app running?' };
  }
}

/** Typed client for the data layer. Failed calls throw an Error whose message is safe to show to the user. */
export const api = new Proxy({} as Api, {
  get:
    (_target, method: string) =>
    async (...args: unknown[]) => {
      const envelope = await transport(method, args);
      if (!envelope.ok) {
        // A locked app answers every call this way; tell the access provider so it can show the sign-in page.
        if (envelope.error === LOCKED_MESSAGE && method !== 'accessStatus') window.dispatchEvent(new Event('invoiceon:locked'));
        throw new Error(envelope.error);
      }
      return envelope.data;
    },
});

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong.');
