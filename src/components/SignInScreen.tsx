import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { useRefresh } from '../lib/data';
import { Logo } from './Layout';
import { Button, ErrorNote, Field, Input, Select } from './ui';

/** The first thing seen when people are set up: choose your name, type your PIN. */
export function SignInScreen({ people }: { people: { id: string; name: string }[] }) {
  const refresh = useRefresh();
  const [who, setWho] = useState(people[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.sessionLogin(who, pin);
      setPin('');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-canvas p-6">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-7"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-center gap-2.5">
          <Logo size={32} />
          <span className="text-lg tracking-tight">InvoiceOn</span>
        </div>
        <p className="text-sm text-ink-muted">Choose your name and type your PIN.</p>
        <Field label="Who is this?">
          <Select value={who} onChange={(e) => setWho(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="PIN">
          <Input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="num" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="primary" type="submit" loading={busy} disabled={!who || pin.length < 4} className="w-full justify-center">
          Sign in
        </Button>
        <p className="text-xs text-ink-muted">A PIN keeps the book private on a shared computer and tells the activity log who did what. It does not encrypt the data file.</p>
      </form>
    </div>
  );
}
