import { Gift } from 'lucide-react';
import { useState } from 'react';
import { LOYALTY_KIND_LABEL } from '../../../shared/offers';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, Field, Input, Money } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { formatDateTime } from '../../lib/format';

/** A customer's loyalty points: the balance, what it is worth, and every change. Shown when points are on, or when the customer has any. */
export function LoyaltyCard({ customerId }: { customerId: string }) {
  const refresh = useRefresh();
  const { can } = useAccess();
  const config = useQuery(() => api.loyaltyConfig());
  const account = useQuery(() => api.loyaltyAccount(customerId), [customerId]);
  const [all, setAll] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const a = account.data;
  if (!a || !config.data) return null;
  if (!config.data.enabled && a.entries.length === 0) return null;
  const entries = all ? a.entries : a.entries.slice(0, 5);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base">
          <Gift className="h-4 w-4 text-brand" aria-hidden /> Loyalty points
        </h2>
        {can('cancel') && <Button onClick={() => setAdjusting(true)}>Adjust</Button>}
      </div>
      <Card className="p-5">
        <div className="flex items-baseline gap-3">
          <span className="num text-3xl tracking-tight">{a.points}</span>
          <span className="text-ink-muted">
            points{a.valuePaise > 0 && <> worth <Money paise={a.valuePaise} fractionDigits={0} /></>}
            {!config.data.enabled && ', not earning (switched off in Settings)'}
          </span>
        </div>
        {entries.length > 0 && (
          <ul className="mt-4 divide-y divide-line/70 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-4 py-2">
                <span className="num w-12 text-right font-medium">{e.points > 0 ? `+${e.points}` : e.points}</span>
                <span className="min-w-0 flex-1 truncate">
                  {LOYALTY_KIND_LABEL[e.kind]}
                  {e.note && <span className="text-ink-muted"> · {e.note}</span>}
                </span>
                <span className="text-xs text-ink-muted">{formatDateTime(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
        {a.entries.length > 5 && (
          <button type="button" className="mt-2 text-xs text-brand underline-offset-2 hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${a.entries.length}`}
          </button>
        )}
      </Card>
      {adjusting && <AdjustDialog customerId={customerId} onClose={() => setAdjusting(false)} onDone={() => { setAdjusting(false); refresh(); }} />}
    </section>
  );
}

function AdjustDialog({ customerId, onClose, onDone }: { customerId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.loyaltyAdjust(customerId, Math.trunc(Number(points) || 0), note);
      toast.success('Points adjusted');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Adjust points"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!points || !note.trim()} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Points" hint="Use a minus sign to take points away, for example -20.">
          <Input type="number" autoFocus className="num" value={points} onChange={(e) => setPoints(e.target.value)} />
        </Field>
        <Field label="Reason" hint="Kept with the change.">
          <Input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} placeholder="Birthday bonus" />
        </Field>
      </form>
    </Modal>
  );
}
