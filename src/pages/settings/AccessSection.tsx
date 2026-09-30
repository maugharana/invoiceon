import { Lock, Plus, ShieldCheck, UserRound } from 'lucide-react';
import { useState } from 'react';
import { PIN_PATTERN, ROLES, ROLE_BLURB, ROLE_LABEL, type AccessUser, type Role } from '../../../shared/access';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Pill, Select, Spinner } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import type { Draft, SetDraft } from './draft';

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 8);

/** Users and PINs. Off by default: the app behaves exactly as it always has until the owner turns it on. */
export function AccessSection({ draft, set }: { draft: Draft; set: SetDraft }) {
  const { status, refresh } = useAccess();
  if (!status) return <Spinner />;
  if (!status.enabled) return <TurnOn onDone={refresh} />;
  if (status.user?.role !== 'owner') return <p className="text-ink-muted">Only the owner can manage who uses InvoiceOn.</p>;
  return <People ownerId={status.user.id} draft={draft} set={set} onOff={refresh} />;
}

function TurnOn({ onDone }: { onDone: () => Promise<void> }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enable() {
    if (!name.trim()) return setError('Enter your name.');
    if (!PIN_PATTERN.test(pin)) return setError('A PIN is 4 to 8 digits.');
    if (pin !== again) return setError('The two PINs do not match.');
    setBusy(true);
    setError(null);
    try {
      await api.accessEnable(name, pin);
      toast.success('Sign-in is on. You are signed in as the owner.');
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-lg space-y-5">
      <div className="flex gap-3 rounded-lg bg-brand-tint p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <p className="text-sm">
          Right now anyone at this computer can do anything. Turn on sign-in to give each person a PIN, and to keep costs, profit, settings and backups to the people who should see them. You can turn it off again whenever you like.
        </p>
      </div>
      <ul className="space-y-2 text-sm">
        {ROLES.map((r) => (
          <li key={r}>
            <span className="font-medium">{ROLE_LABEL[r]}.</span> <span className="text-ink-muted">{ROLE_BLURB[r]}</span>
          </li>
        ))}
      </ul>
      {error && <ErrorNote>{error}</ErrorNote>}
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void enable(); }}>
        <Field label="Your name" hint="You become the owner.">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Choose a PIN" hint="4 to 8 digits.">
            <Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
          </Field>
          <Field label="PIN again">
            <Input type="password" inputMode="numeric" autoComplete="off" value={again} onChange={(e) => setAgain(digits(e.target.value))} />
          </Field>
        </div>
        <Button variant="primary" type="submit" loading={busy} icon={<Lock className="h-4 w-4" />}>
          Turn on sign-in
        </Button>
      </form>
      <p className="text-xs text-ink-muted">Keep the owner PIN safe. There is no way to reset it from inside the app, because that would defeat the point.</p>
    </div>
  );
}

function People({ ownerId, draft, set, onOff }: { ownerId: string; draft: Draft; set: SetDraft; onOff: () => Promise<void> }) {
  const users = useQuery(() => api.accessUsers());
  const refreshData = useRefresh();
  const [editing, setEditing] = useState<AccessUser | 'new' | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base">People</h3>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
            Add a person
          </Button>
        </div>
        {users.error && <ErrorNote>{users.error}</ErrorNote>}
        <ul className="divide-y divide-line/70 rounded-lg border border-line">
          {users.data?.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-3">
              <UserRound className="h-5 w-5 text-ink-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className={`truncate ${u.active ? '' : 'text-ink-muted line-through'}`}>{u.name}</div>
                <div className="text-xs text-ink-muted">{ROLE_LABEL[u.role]}</div>
              </div>
              {u.id === ownerId && <Pill tone="neutral">You</Pill>}
              {!u.active && <Pill tone="neutral">Inactive</Pill>}
              <Button onClick={() => setEditing(u)}>Edit</Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-sm">
        <Field label="Lock after" hint="Minutes without use before the app asks for a PIN again. 0 means never.">
          <div className="flex items-center gap-2">
            <Input type="number" min={0} max={600} className="num w-24" value={draft.autoLockMinutes} onChange={(e) => set('autoLockMinutes', e.target.value)} />
            <span className="text-ink-muted">minutes</span>
          </div>
        </Field>
      </section>

      <section className="border-t border-line pt-5">
        <h3 className="text-base">Turn off sign-in</h3>
        <p className="mb-3 mt-1 text-sm text-ink-muted">Everyone can then use everything again, without a PIN. The people and their PINs are kept, in case you turn it back on.</p>
        <Button onClick={() => setTurningOff(true)}>Turn off sign-in</Button>
      </section>

      {editing && (
        <PersonDialog
          person={editing === 'new' ? null : editing}
          isMe={editing !== 'new' && editing.id === ownerId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshData();
          }}
        />
      )}
      {turningOff && <TurnOffDialog onClose={() => setTurningOff(false)} onDone={onOff} />}
    </div>
  );
}

function PersonDialog({ person, isMe, onClose, onSaved }: { person: AccessUser | null; isMe: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(person?.name ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'staff');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(person?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError('Enter a name.');
    if (!person && !PIN_PATTERN.test(pin)) return setError('Choose a PIN of 4 to 8 digits.');
    if (person && pin && !PIN_PATTERN.test(pin)) return setError('A PIN is 4 to 8 digits.');
    setBusy(true);
    setError(null);
    try {
      await api.accessUserSave(person?.id ?? null, { name, role, active, ...(pin ? { pin } : {}) });
      toast.success(person ? 'Saved' : `${name.trim()} can now sign in`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={person ? `Edit ${person.name}` : 'Add a person'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {person ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
        </Field>
        <Field label="Role" hint={ROLE_BLURB[role]}>
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={person ? 'New PIN' : 'PIN'} hint={person ? 'Leave empty to keep the current PIN.' : '4 to 8 digits.'}>
          <Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        </Field>
        {person && !isMe && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Can sign in
          </label>
        )}
      </form>
    </Modal>
  );
}

function TurnOffDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function off() {
    setBusy(true);
    setError(null);
    try {
      await api.accessDisable(pin);
      toast.success('Sign-in is off');
      await onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Turn off sign-in"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!pin} onClick={() => void off()}>
            Turn off
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void off(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Your PIN" hint="The owner's PIN is needed to switch sign-in off.">
          <Input type="password" inputMode="numeric" autoFocus autoComplete="off" value={pin} onChange={(e) => setPin(digits(e.target.value))} />
        </Field>
      </form>
    </Modal>
  );
}
