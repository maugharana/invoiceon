import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { USER_ROLES, USER_ROLE_LABEL, type AppUser, type UserRole } from '../../../shared/types';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useSession } from '../../lib/session';

type Editing = { kind: 'new' } | { kind: 'pin'; user: AppUser } | null;

/** Who can use the book. Owners can do everything; staff can sell, take payments and add stock, but not change settings or cancel. */
export function PeopleSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const session = useSession();
  const list = useQuery(() => api.usersList());
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<AppUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try {
      await fn();
      if (done) toast.success(done);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (session.enabled && session.current?.role !== 'owner') return <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">Only an owner can manage people.</p>;
  const users = list.data ?? [];

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">
        {session.enabled
          ? 'Everyone signs in with their name and a PIN. Owners can do everything. Staff can make invoices, take payments and add stock, but cannot change settings, cancel or write off, see profit reports or work with backups.'
          : 'Nobody signs in at the moment. Add an owner to switch signing in on: from then on, the book asks for a name and PIN, and the activity log notes who did what.'}
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {list.loading && !list.data ? (
        <Spinner />
      ) : (
        users.length > 0 && (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    {u.name}
                    {u.id === session.current?.id && <span className="ml-2 text-xs text-ink-muted">you</span>}
                    {!u.active && <span className="ml-2 text-xs text-ink-muted">switched off</span>}
                  </span>
                  <Select className="w-28" aria-label={`Role of ${u.name}`} value={u.role} onChange={(e) => void act(() => api.userUpdate(u.id, { role: e.target.value as UserRole }))}>
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {USER_ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                  <Button className="h-8 px-3 text-xs" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setEditing({ kind: 'pin', user: u })}>
                    New PIN
                  </Button>
                  <Button className="h-8 px-3 text-xs" onClick={() => void act(() => api.userUpdate(u.id, { active: !u.active }))}>
                    {u.active ? 'Switch off' : 'Switch on'}
                  </Button>
                  <Button className="h-8 px-3 text-xs" aria-label={`Remove ${u.name}`} icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setRemoving(u)} />
                </li>
              ))}
            </ul>
          </Card>
        )
      )}
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ kind: 'new' })}>
        {users.length === 0 ? 'Add the first owner' : 'Add a person'}
      </Button>
      {editing?.kind === 'new' && <PersonModal first={users.length === 0} onClose={() => setEditing(null)} />}
      {editing?.kind === 'pin' && <PinModal user={editing.user} onClose={() => setEditing(null)} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          body="They will no longer be able to sign in. What they did stays in the activity log."
          confirmLabel="Remove"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.userRemove(removing.id);
            setRemoving(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function PersonModal({ first, onClose }: { first: boolean; onClose: () => void }) {
  const refresh = useRefresh();
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>(first ? 'owner' : 'staff');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.userCreate({ name, role, pin });
      onClose();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={first ? 'Add the first owner' : 'Add a person'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {first && <p className="text-xs text-ink-muted">Once added, the book asks for this name and PIN each time it opens. Remember the PIN: an owner can set a new one for anyone else, but if the only owner forgets theirs, the book needs the data file's help to reopen.</p>}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {!first && (
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {USER_ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="PIN" hint="4 to 8 digits">
          <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="num" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

function PinModal({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await api.userSetPin(user.id, pin);
      toast.success('PIN changed');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={`New PIN for ${user.name}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="PIN" hint="4 to 8 digits">
          <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} autoFocus value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="num" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
