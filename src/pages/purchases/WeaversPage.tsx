import { ChevronRight, Plus, SearchX, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { Weaver } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, EmptyState, ErrorNote, Field, Figure, Input, Money, SearchInput, TableSkeleton, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { PurchasesShell } from './PurchasesShell';

export function WeaverFormModal({ weaver, onClose, onSaved }: { weaver?: Weaver; onClose: () => void; onSaved: (w: Weaver) => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(weaver?.name ?? '');
  const [phone, setPhone] = useState(weaver?.phone ?? '');
  const [place, setPlace] = useState(weaver?.place ?? '');
  const [notes, setNotes] = useState(weaver?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = { name, phone, place, notes };
      const saved = weaver ? await api.weaverUpdate(weaver.id, input) : await api.weaverCreate(input);
      refresh();
      toast.success(weaver ? 'Weaver updated' : `${saved.name} added`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={weaver ? 'Edit weaver' : 'New weaver'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="weaver-form" loading={saving}>
            {weaver ? 'Save changes' : 'Add weaver'}
          </Button>
        </>
      }
    >
      <form id="weaver-form" onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rafiq Ansari" data-autofocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Place" hint="Village, town or workshop">
            <Input value={place} onChange={(e) => setPlace(e.target.value)} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Looms, specialities, anything worth remembering (optional)" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}

export function WeaversPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 150);
    return () => clearTimeout(t);
  }, [search]);

  const weavers = useQuery(() => api.weaversList({ search: debounced }), [debounced]);
  const everyone = useQuery(() => api.weaversList());
  const list = weavers.data;
  const all = everyone.data ?? [];
  const none = everyone.data?.length === 0;
  const owed = all.reduce((s, w) => s + Math.max(0, w.balancePaise), 0);
  const pieces = all.reduce((s, w) => s + w.piecesPending, 0);

  const add = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
      Add weaver
    </Button>
  );

  return (
    <PurchasesShell tab="weavers" actions={add}>
      {weavers.error && <ErrorNote>{weavers.error}</ErrorNote>}
      {none ? (
        <Card>
          <EmptyState icon={<Users className="h-6 w-6" />} title="No weavers yet" body="Add the weavers who make sarees for you. Give them an order, note the yarn you hand over, receive the pieces as they come, and always know what you owe them." actions={<Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add weaver</Button>} />
        </Card>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-3 gap-6">
            <Figure label="You owe weavers" sub="Wages on pieces received, less payments" highlight>
              <Money paise={owed} fractionDigits={0} />
            </Figure>
            <Figure label="Pieces still with weavers" sub={plural(all.reduce((s, w) => s + w.openOrders, 0), 'open order')}>
              {pieces}
            </Figure>
            <Figure label="Weavers">{all.length}</Figure>
          </div>
          <div className="mb-4">
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or place" />
          </div>
          <Card className="overflow-x-auto">
            {weavers.loading ? (
              <TableSkeleton />
            ) : list?.length === 0 ? (
              <EmptyState icon={<SearchX className="h-6 w-6" />} title="No weavers match" body={`Nothing found for "${debounced}".`} actions={<Button onClick={() => setSearch('')}>Clear search</Button>} />
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-line">
                    <th className="th">Weaver</th>
                    <th className="th">Place</th>
                    <th className="th text-right">Open orders</th>
                    <th className="th text-right">Pieces out</th>
                    <th className="th text-right">You owe</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {list?.map((w) => (
                    <tr key={w.id} tabIndex={0} onClick={() => navigate(paths.weaver(w.id))} onKeyDown={(e) => e.key === 'Enter' && navigate(paths.weaver(w.id))} className="animate-fade-in group cursor-pointer border-b border-line/70 transition-colors duration-150 last:border-0 hover:bg-canvas focus-visible:bg-canvas">
                      <td className="td">
                        {w.name}
                        {w.phone && <div className="text-xs text-ink-muted">{w.phone}</div>}
                      </td>
                      <td className="td text-ink-muted">{w.place || '-'}</td>
                      <td className="td num text-right">{w.openOrders}</td>
                      <td className="td num text-right">{w.piecesPending}</td>
                      <td className="td text-right">{w.balancePaise > 0 ? <Money paise={w.balancePaise} /> : w.balancePaise < 0 ? <span className="text-status-partial-fg"><Money paise={-w.balancePaise} /> advance</span> : <span className="text-ink-muted/50">-</span>}</td>
                      <td className="td text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-muted"><ChevronRight className="h-4 w-4" aria-hidden /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
      {adding && <WeaverFormModal onClose={() => setAdding(false)} onSaved={(w) => { setAdding(false); navigate(paths.weaver(w.id)); }} />}
    </PurchasesShell>
  );
}
