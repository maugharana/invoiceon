import { KeyRound, LockKeyhole } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_HOME, ROLE_LABEL } from '../../shared/roles';
import type { AuthUser } from '../../shared/types';
import { RecoveryCodeModal } from './settings/UsersSection';
import { Button, ErrorNote, Field, Input, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { navigate } from '../lib/router';

/** Shown instead of the app when the shop uses sign-in and nobody has signed in. Choose your name, type your PIN. */
export function SignInScreen() {
  const auth = useAuth();
  const [people, setPeople] = useState<AuthUser[] | null>(null);
  const [picked, setPicked] = useState<AuthUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    api.authUsers().then((p) => {
      setPeople(p);
      if (p.length === 1) setPicked(p[0]!);
    }).catch((err) => setError(errorMessage(err)));
  }, []);

  async function enter(e: FormEvent) {
    e.preventDefault();
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const user = await api.authSignIn({ userId: picked.id, pin });
      setPin('');
      navigate(ROLE_HOME[user.role]);
      await auth.reload();
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
      setBusy(false);
    }
  }

  async function recover(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api.authRecover({ code, newPin });
      setFresh(made.recoveryCode);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-tint text-brand">
            <LockKeyhole className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-xl tracking-tight">InvoiceOn</h1>
          <p className="mt-1 text-ink-muted">{forgot ? 'Reset the owner PIN with your recovery code.' : picked ? `Welcome, ${picked.name}. Enter your PIN.` : 'Who is using InvoiceOn?'}</p>
        </div>

        <div className="rounded-xl border border-line bg-surface p-5">
          {!people ? (
            <Spinner />
          ) : forgot ? (
            <form onSubmit={recover} className="space-y-4">
              <Field label="Recovery code" hint="The code shown when sign-in was turned on, like 3F9A-12BC-77D0.">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" className="num" autoComplete="off" autoFocus />
              </Field>
              <Field label="New PIN" hint="4 to 8 digits.">
                <Input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 8))} className="num" autoComplete="off" />
              </Field>
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button variant="primary" type="submit" loading={busy} disabled={!code.trim() || newPin.length < 4} className="w-full">
                Reset PIN and sign in
              </Button>
              <button type="button" onClick={() => { setForgot(false); setError(null); }} className="w-full text-center text-xs text-ink-muted hover:text-ink">
                Back
              </button>
            </form>
          ) : !picked ? (
            <ul className="space-y-2">
              {people.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => { setPicked(p); setError(null); }} className="flex w-full items-center justify-between rounded-lg border border-line px-4 py-3 text-left transition-colors hover:border-brand hover:bg-brand-tint">
                    <span>{p.name}</span>
                    <span className="text-xs text-ink-muted">{ROLE_LABEL[p.role]}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <form onSubmit={enter} className="space-y-4">
              <Field label="PIN">
                <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} className="num text-center text-lg tracking-widest" autoComplete="off" autoFocus aria-label="PIN" />
              </Field>
              {error && <ErrorNote>{error}</ErrorNote>}
              <Button variant="primary" type="submit" loading={busy} disabled={pin.length < 4} className="w-full">
                Sign in
              </Button>
              {people.length > 1 && (
                <button type="button" onClick={() => { setPicked(null); setPin(''); setError(null); }} className="w-full text-center text-xs text-ink-muted hover:text-ink">
                  Not {picked.name}?
                </button>
              )}
            </form>
          )}
          {error && !picked && !forgot && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        </div>

        {!forgot && people && (
          <button type="button" onClick={() => { setForgot(true); setError(null); }} className="mt-4 inline-flex w-full items-center justify-center gap-1.5 text-xs text-ink-muted hover:text-ink">
            <KeyRound className="h-3.5 w-3.5" aria-hidden /> Forgot the owner PIN?
          </button>
        )}
      </div>
      {fresh && (
        <RecoveryCodeModal
          code={fresh}
          onDone={async () => {
            setFresh(null);
            navigate(ROLE_HOME.owner);
            await auth.reload();
          }}
        />
      )}
    </main>
  );
}
