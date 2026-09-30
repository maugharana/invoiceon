import { Delete } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ROLE_LABEL, type AccessStatus } from '../../shared/access';
import { Logo } from '../components/Layout';
import { Button } from '../components/ui';
import { api, errorMessage } from '../lib/api';

/** Who is using the app? Pick your name, enter your PIN. Shown whenever access control is on and nobody is signed in. */
export function LockScreen({ status, onSignedIn }: { status: AccessStatus; onSignedIn: () => Promise<void> }) {
  const [who, setWho] = useState<string | null>(status.people.length === 1 ? status.people[0]!.id : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const person = status.people.find((p) => p.id === who);

  async function submit(entered = pin) {
    if (!who || entered.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.accessLogin(who, entered);
      await onSignedIn();
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
      setBusy(false);
    }
  }

  // Digits from the keyboard work as well as the pad.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!who || busy) return;
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 8 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') void submit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who, busy, pin]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="animate-fade-up w-full max-w-sm rounded-lg border border-line bg-surface p-8 text-center shadow-overlay">
        <div className="mb-5 flex flex-col items-center gap-3">
          <Logo size={44} live />
          <div>
            <div className="text-lg tracking-tight">{status.businessName || 'InvoiceOn'}</div>
            <div className="text-xs text-ink-muted">{person ? 'Enter your PIN' : 'Who is using InvoiceOn?'}</div>
          </div>
        </div>

        {!person ? (
          <ul className="space-y-2" aria-label="People">
            {status.people.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { setWho(p.id); setPin(''); setError(null); }} className="flex h-12 w-full items-center justify-between rounded-lg border border-line px-4 text-left transition-colors duration-150 hover:border-brand/50 hover:bg-brand-tint">
                  <span>{p.name}</span>
                  <span className="text-xs text-ink-muted">{ROLE_LABEL[p.role]}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="mb-4 text-ink-muted">{person.name}</div>
            <div className="mb-5 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
              {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
                <span key={i} className={`h-3 w-3 rounded-full border transition-colors duration-150 ${i < pin.length ? 'border-brand bg-brand' : 'border-line'}`} />
              ))}
            </div>
            {error && <p role="alert" className="mb-4 rounded-lg bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue-fg">{error}</p>}
            <div className="mx-auto grid max-w-[15rem] grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" aria-label={d} disabled={busy} onClick={() => setPin((p) => (p.length < 8 ? p + d : p))} className="num h-12 rounded-lg border border-line text-lg transition-colors duration-150 hover:bg-canvas active:bg-brand-tint">
                  {d}
                </button>
              ))}
              <button type="button" aria-label="Back to the list of people" onClick={() => { setWho(null); setPin(''); setError(null); }} className="h-12 rounded-lg text-xs text-ink-muted transition-colors hover:text-ink">
                Change
              </button>
              <button type="button" aria-label="0" disabled={busy} onClick={() => setPin((p) => (p.length < 8 ? p + '0' : p))} className="num h-12 rounded-lg border border-line text-lg transition-colors duration-150 hover:bg-canvas active:bg-brand-tint">
                0
              </button>
              <button type="button" aria-label="Delete last digit" disabled={busy} onClick={() => setPin((p) => p.slice(0, -1))} className="flex h-12 items-center justify-center rounded-lg text-ink-muted transition-colors hover:text-ink">
                <Delete className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <Button variant="primary" className="mt-5 w-full" loading={busy} disabled={pin.length < 4} onClick={() => void submit()}>
              Sign in
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
