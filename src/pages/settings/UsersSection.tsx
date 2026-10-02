import { Plus, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ROLES, ROLE_HINT, ROLE_LABEL, type Role } from '../../../shared/roles';
import type { ManagedUser } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Pill, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime } from '../../lib/format';

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 8);

/** The recovery code is shown once, then only its hash is kept. Writing it down is the only way back from a forgotten owner PIN. */
export function RecoveryCodeModal({ code, onDone }: { code: string; onDone: () => void }) {
  return (
    <Modal title="Your recovery code" size="sm" onClose={onDone} footer={<Button variant="primary" onClick={onDone}>I have written it down</Button>}>
      <p className="text-ink-muted">If the owner ever forgets the PIN, this code is the only way back in. It is shown just this once. Write it on paper and keep it somewhere safe, away from the computer.</p>
      <div className="num my-4 rounded-lg bg-canvas py-4 text-center text-2xl tracking-widest select-all">{code}</div>
    </Modal>
  );
}

/** Turning sign-in on, and looking after who can use the app and what each can do. Owner only. */
export function UsersSection() {
  const auth = useAuth();
  const required = auth.status?.required ?? false;
  return required ? <People /> : <TurnOn />;
}

function TurnOn() {
  const auth = useAuth();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pin !== again) return setError('The two PINs are different.');
    setBusy(true);
    setError(null);
    try {
      const made = await api.authSetup({ name, pin });
      setCode(made.recoveryCode);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-start gap-3 rounded-lg bg-canvas p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <p className="text-ink-muted">
          Right now anyone who opens InvoiceOn can do everything. Turn on sign-in to ask for a name and PIN, give your staff only what they need (counter staff can sell but cannot see expenses, reports or settings), and see who did what in the activity log.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <h3 className="text-base">Make yourself the owner</h3>
        <Field label="Your name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmad" maxLength={40} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="PIN" hint="4 to 8 digits.">
            <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} className="num" autoComplete="off" />
          </Field>
          <Field label="PIN again">
            <Input type="password" inputMode="numeric" value={again} onChange={(e) => setAgain(digits(e.target.value))} className="num" autoComplete="off" />
          </Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Button variant="primary" type="submit" loading={busy} disabled={!name.trim() || pin.length < 4}>
          Turn on sign-in
        </Button>
        <p className="text-xs text-ink-muted">You will be given a recovery code to write down. A PIN keeps honest people out of the screens; it does not lock the data file itself, so keep the computer and your backups safe too.</p>
      </form>
      {code && (
        <RecoveryCodeModal
          code={code}
          onDone={async () => {
            setCode(null);
            await auth.reload();
          }}
        />
      )}
    </div>
  );
}

function People() {
  const toast = useToast();
  const refresh = useRefresh();
  const auth = useAuth();
  const me = auth.status?.user;
  const list = useQuery(() => api.userList());
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [changingOwn, setChangingOwn] = useState(false);
  const [turningOff, setTurningOff] = useState(false);

  async function change(u: ManagedUser, patch: { role?: Role; active?: boolean }) {
    try {
      await api.userUpdate(u.id, patch);
      refresh();
      await auth.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (list.error) return <ErrorNote>{list.error}</ErrorNote>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-ink-muted">Everyone who can open InvoiceOn. What each person can do depends on their role; a change takes effect on their very next action.</p>
        <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
          Add a person
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-canvas text-left text-xs text-ink-muted">
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((u) => (
              <tr key={u.id} className={`border-b border-line/70 last:border-0 ${u.active ? '' : 'text-ink-muted'}`}>
                <td className="px-4 py-2.5">
                  {u.name}
                  {u.id === me?.id && <span className="ml-2 text-xs text-ink-muted">(you)</span>}
                  {!u.active && <Pill tone="neutral">Removed</Pill>}
                  <div className="text-xs text-ink-muted">Added {formatDateTime(u.createdAt)}</div>
                </td>
                <td className="px-4 py-2.5">
                  <Select value={u.role} onChange={(e) => void change(u, { role: e.target.value as Role })} aria-label={`Role of ${u.name}`} className="h-8 w-44">
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex justify-end gap-2">
                    <Button className="h-8 px-3 text-xs" onClick={() => (u.id === me?.id ? setChangingOwn(true) : setResetting(u))}>
                      {u.id === me?.id ? 'Change my PIN' : 'Reset PIN'}
                    </Button>
                    <Button className="h-8 px-3 text-xs" onClick={() => void change(u, { active: !u.active })}>
                      {u.active ? 'Remove' : 'Bring back'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="space-y-1.5 rounded-lg bg-canvas p-4 text-ink-muted">
        {ROLES.map((r) => (
          <div key={r}>
            <dt className="inline text-ink">{ROLE_LABEL[r]}: </dt>
            <dd className="inline">{ROLE_HINT[r]}</dd>
          </div>
        ))}
      </dl>

      <div className="border-t border-line pt-4">
        <Button variant="danger" onClick={() => setTurningOff(true)}>
          Turn off sign-in
        </Button>
        <p className="mt-2 text-xs text-ink-muted">Removes everyone and opens the app straight in again, as it was before. Needs the owner PIN.</p>
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} />}
      {resetting && <PinModal title={`New PIN for ${resetting.name}`} onClose={() => setResetting(null)} onSave={(pin) => api.userResetPin(resetting.id, pin)} done={`${resetting.name}'s PIN changed`} />}
      {changingOwn && <ChangeOwn onClose={() => setChangingOwn(false)} />}
      {turningOff && (
        <Modal
          title="Turn off sign-in?"
          size="sm"
          onClose={() => setTurningOff(false)}
          footer={null}
        >
          <TurnOffForm
            onDone={async () => {
              setTurningOff(false);
              await auth.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AddPerson({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.userCreate({ name, role, pin });
      refresh();
      toast.success(`${name} added`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Modal title="Add a person" size="sm" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim() || pin.length < 4} onClick={() => void save()}>Add</Button></>}>
      <div className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} data-autofocus />
        </Field>
        <Field label="What can they do?" hint={ROLE_HINT[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="PIN" hint="4 to 8 digits. They can change it themselves later.">
          <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} className="num" autoComplete="off" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function PinModal({ title, onClose, onSave, done }: { title: string; onClose: () => void; onSave: (pin: string) => Promise<unknown>; done: string }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave(pin);
      toast.success(done);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Modal title={title} size="sm" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={pin.length < 4} onClick={() => void save()}>Save</Button></>}>
      <Field label="New PIN" hint="4 to 8 digits.">
        <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} className="num" autoComplete="off" data-autofocus />
      </Field>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
    </Modal>
  );
}

function ChangeOwn({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.authChangePin({ oldPin, newPin });
      toast.success('Your PIN is changed');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Modal title="Change my PIN" size="sm" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={oldPin.length < 4 || newPin.length < 4} onClick={() => void save()}>Save</Button></>}>
      <div className="space-y-4">
        <Field label="Current PIN">
          <Input type="password" inputMode="numeric" value={oldPin} onChange={(e) => setOldPin(digits(e.target.value))} className="num" autoComplete="off" data-autofocus />
        </Field>
        <Field label="New PIN" hint="4 to 8 digits.">
          <Input type="password" inputMode="numeric" value={newPin} onChange={(e) => setNewPin(digits(e.target.value))} className="num" autoComplete="off" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function TurnOffForm({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.authDisable({ pin });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <form onSubmit={go} className="space-y-4">
      <p className="text-ink-muted">Everyone is removed and anyone who opens InvoiceOn can do everything again. Enter the owner PIN to confirm.</p>
      <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(digits(e.target.value))} className="num" autoComplete="off" aria-label="Owner PIN" data-autofocus />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button variant="danger" type="submit" loading={busy} disabled={pin.length < 4} className="w-full">
        Turn off sign-in
      </Button>
    </form>
  );
}
