import { PackageOpen } from 'lucide-react';
import type { Proforma } from '../../../shared/types';
import { WEAVER_ORDER_STATUS_LABEL } from '../../../shared/types';
import { Button, Card, Pill } from '../../components/ui';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { WEAVER_STATUS_TONE } from '../inventory/WeaverOrdersPage';

/**
 * On a quote: the orders placed with weavers for it, and a way to order what is short. Shown only when there is something to say, so a
 * quote for sarees that are all in stock looks the same as it always did.
 */
export function WeaverCard({ quote: p, live }: { quote: Proforma; live: boolean }) {
  const orders = useQuery(() => api.weaverOrdersList({ proformaId: p.id }), [p.id]);
  // The draft is refused when nothing is short, which here just means "nothing to order".
  const short = useQuery(() => (live ? api.weaverOrderDraft(p.id).then((d) => d.lines.reduce((s, l) => s + l.qty, 0)).catch(() => 0) : Promise.resolve(0)), [p.id, live, p.status]);
  const list = (orders.data ?? []).filter((o) => o.status !== 'cancelled');
  const toCome = list.reduce((s, o) => s + (o.pieces - o.receivedPieces), 0);
  const shortPieces = short.data ?? 0;
  if (list.length === 0 && shortPieces === 0) return null;
  const arrived = list.length > 0 && toCome === 0 && shortPieces === 0;

  return (
    <Card className="mb-6 p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base">
          <PackageOpen className="h-4 w-4 text-ink-muted" aria-hidden /> Weaver orders
        </h2>
        {live && shortPieces > 0 && (
          <Button onClick={() => navigate(paths.newWeaverOrder(p.id))} title="Order what is short from a weaver, starting from this quote">
            Order from weaver
          </Button>
        )}
      </div>
      {shortPieces > 0 && live && <p className="mb-3 text-ink-muted">{plural(shortPieces, 'piece')} on this quote {shortPieces === 1 ? 'is' : 'are'} not in stock and not on order yet.</p>}
      {arrived && live && <p className="mb-3 text-status-paid-fg">Everything ordered has arrived. This quote is ready to invoice.</p>}
      {list.length > 0 && (
        <ul className="divide-y divide-line/70">
          {list.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <a href={`#${paths.weaverOrder(o.id)}`} className="num text-brand transition-colors hover:text-brand-hover">
                  {o.number}
                </a>
                <span className="ml-2 text-ink-muted">{o.vendorName}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="num text-xs text-ink-muted">
                  {o.receivedPieces} of {o.pieces} arrived
                </span>
                <Pill tone={WEAVER_STATUS_TONE[o.status]}>{WEAVER_ORDER_STATUS_LABEL[o.status]}</Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
