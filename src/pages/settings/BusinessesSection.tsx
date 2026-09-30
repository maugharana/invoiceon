import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Business } from '../../../shared/business';
import { ConfirmDialog, Modal } from '../../components/Modal';
import { flashAfterReload, useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Pill, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

/** Several businesses in one installation. Each has its own stock, invoices, customers, settings, users and backups, and never mixes with another. */
export function BusinessesSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const list = useQuery(() => (window.invoiceon ? api.businessesList() : Promise.resolve(null)));
  const [editing, setEditing] = useState<Business | 'new' | null>(null);
  const [removing, setRemoving] = useState<Business | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);

  if (!window.invoiceon) return <p className="text-ink-muted">Keeping more than one business is part of the InvoiceOn desktop app. Open the app on the shop computer to add or switch between businesses.</p>;
  if (list.error && !list.data) return <ErrorNote>{list.error}</ErrorNote>;
  if (!list.data) return <Spinner />;

  async function open(b: Business) {
    setSwitching(b.id);
    try {
      await api.businessSwitch(b.id);
      flashAfterReload(`Now working in ${b.name}.`);
      window.location.hash = '/dashboard';
      window.location.reload();
    } catch (err) {
      toast.error(errorMessage(err));
      setSwitching(null);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-ink-muted">Use one installation for more than one business. Each keeps its own stock, invoices, customers, settings, people and backups, so nothing from one ever shows in another. Switching reloads the app in the other business.</p>
      <ul className="divide-y divide-line/70 rounded-lg border border-line">
        {list.data.businesses.map((b) => (
          <li key={b.id} className="flex items-center gap-4 px-4 py-3">
            <Building2 className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{b.name}</div>
              <div className="num truncate text-xs text-ink-muted">{b.dir}</div>
            </div>
            {b.active ? (
              <Pill tone="paid">Open now</Pill>
            ) : (
              <Button loading={switching === b.id} disabled={switching !== null} onClick={() => void open(b)}>
                Open
              </Button>
            )}
            <button type="button" className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setEditing(b)}>
              Rename
            </button>
            {!b.active && b.id !== 'main' && (
              <button type="button" className="text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setRemoving(b)}>
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
        Add a business
      </Button>

      {editing && <NameDialog business={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name} from the list?`}
          confirmLabel="Remove from the list"
          danger
          onClose={() => setRemoving(null)}
          body={<p>Nothing is deleted. Its files stay in <span className="num text-ink">{removing.dir}</span>, but the app stops offering it. A person who can copy a folder can bring it back.</p>}
          onConfirm={async () => {
            await api.businessUnlist(removing.id);
            refresh();
            setRemoving(null);
            toast.success('Removed from the list. Its files are kept.');
          }}
        />
      )}
    </div>
  );
}

function NameDialog({ business, onClose, onDone }: { business: Business | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(business?.name ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (business) await api.businessRename(business.id, name);
      else await api.businessAdd(name);
      onDone();
      toast.success(business ? 'Renamed' : `${name.trim()} added. Open it from the list when you are ready.`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={business ? 'Rename business' : 'Add a business'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Business name" hint={business ? 'This is the name in the list. The name printed on invoices is in Business Profile.' : 'It starts empty, with its own settings to fill in.'}>
          <Input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
