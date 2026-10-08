import type { Invoice } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Card, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { useSession } from '../../lib/session';

/**
 * Who made the sale. Anyone can see it; an owner can put it right afterwards (credit a different person, or no one), because it is
 * not part of the tax document. The commission rate on the invoice becomes the new person's rate.
 */
export function SoldByCard({ invoice }: { invoice: Invoice }) {
  const toast = useToast();
  const refresh = useRefresh();
  const session = useSession();
  const owner = !session.enabled || session.current?.role === 'owner';
  const team = useQuery(() => (owner ? api.salespeopleList() : Promise.resolve([])), [owner]);
  const people = (team.data ?? []).filter((p) => !p.archived);
  const current = invoice.soldBy;
  if (!current && (!owner || people.length === 0)) return null;

  const change = async (id: string) => {
    try {
      const updated = await api.invoiceSetSoldBy(invoice.id, id || null);
      toast.success(updated.soldBy ? `Credited to ${updated.soldBy.name}` : 'No one is credited with this sale now');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 p-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-base">Sold by</h2>
        <p className="mt-0.5 text-xs text-ink-muted">{current ? `${current.name} is credited with this sale${owner ? ` at ${current.commissionPercent}% commission` : ''}.` : 'Nobody is credited with this sale.'}</p>
      </div>
      {owner && (
        <div className="w-56">
          <Select value={current?.id ?? ''} onChange={(e) => void change(e.target.value)} aria-label="Change who made the sale">
            <option value="">No one in particular</option>
            {current?.id && !people.some((p) => p.id === current.id) && (
              <option value={current.id} disabled>
                {current.name} (archived)
              </option>
            )}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      )}
      {!owner && current && <span className="text-sm">{current.name}</span>}
    </Card>
  );
}
