import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import type { Salesperson } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Select, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { useSession } from '../../lib/session';

/** The usual commission rates, so a rate is a pick rather than a typed number. */
const RATES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/**
 * The people who sell. Each bill can be credited to one of them; the commission rate set here is remembered on every bill made while
 * it applies, so changing a rate later never rewrites what was earned.
 */
export function SalesTeamSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const session = useSession();
  const list = useQuery(() => api.salespeopleList());
  const [editing, setEditing] = useState<Salesperson | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await fn();
      toast.success(done);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (session.enabled && session.current?.role !== 'owner') return <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">Only an owner can manage the sales team.</p>;
  const people = list.data ?? [];
  const active = people.filter((p) => !p.archived);
  const archived = people.filter((p) => p.archived);

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">Add the people who make sales. A “Sold by” choice then appears on each new invoice, and the Reports page shows what each person sold and the commission on it. Commission is worked out on the sale before GST, less goods taken back.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      {list.loading && !list.data ? (
        <Spinner />
      ) : (
        active.length > 0 && (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {active.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="min-w-0 flex-1">
                    {p.name}
                    <span className="ml-2 text-xs text-ink-muted">{plural(p.invoiceCount, 'invoice')}</span>
                  </span>
                  <span className="num w-40 text-right text-ink-muted">{p.commissionPercent}% commission</span>
                  <Button className="h-8 px-3 text-xs" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditing(p)}>
                    Edit
                  </Button>
                  <Button className="h-8 px-3 text-xs" onClick={() => void act(() => api.salespersonArchive(p.id), `${p.name} is off the list for new bills`)}>
                    Archive
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )
      )}
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>
        {active.length === 0 ? 'Add the first person' : 'Add a person'}
      </Button>

      {archived.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs uppercase tracking-wider text-ink-muted">Archived</h3>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line/70">
              {archived.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-ink-muted">
                  <span className="min-w-0 flex-1">
                    {p.name}
                    <span className="ml-2 text-xs">{plural(p.invoiceCount, 'invoice')} stay on record</span>
                  </span>
                  <Button className="h-8 px-3 text-xs" onClick={() => void act(() => api.salespersonRestore(p.id), `${p.name} is back on the team`)}>
                    Bring back
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {editing && <PersonModal person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PersonModal({ person, onClose }: { person: Salesperson | null; onClose: () => void }) {
  const refresh = useRefresh();
  const [name, setName] = useState(person?.name ?? '');
  const [rate, setRate] = useState(person?.commissionPercent ?? 0);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      if (person) await api.salespersonUpdate(person.id, { name, commissionPercent: rate });
      else await api.salespersonCreate({ name, commissionPercent: rate });
      onClose();
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Modal
      title={person ? `Edit ${person.name}` : 'Add to the sales team'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()}>
            {person ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </Field>
        <Field label="Commission on what they sell" hint={person ? 'A new rate applies to bills made from now on. Earlier bills keep the rate they were made at.' : 'On the sale before GST, less goods taken back.'}>
          <Select value={String(rate)} onChange={(e) => setRate(Number(e.target.value))}>
            {[...new Set([...RATES, rate])].sort((a, b) => a - b).map((r) => (
              <option key={r} value={r}>
                {r === 0 ? 'None (0%)' : `${r}%`}
              </option>
            ))}
          </Select>
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}
