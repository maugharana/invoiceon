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
        // Signed out behind the screen's back (the owner removed this person, or the app was locked from another window):
        // the app asks who is signed in again and shows the sign-in screen.
        if (envelope.error.startsWith('Sign in to continue') && method !== 'authStatus') window.dispatchEvent(new Event('invoiceon:signed-out'));
        throw new Error(envelope.error);
      }
      return envelope.data;
    },
});

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Something went wrong.');
