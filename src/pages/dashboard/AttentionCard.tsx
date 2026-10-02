import { CalendarHeart, ChevronRight, Clock, HandCoins, PhoneCall, TrendingDown, Undo2, type LucideIcon } from 'lucide-react';
import type { AttentionItem, AttentionKind } from '../../../shared/types';
import { Card } from '../../components/ui';
import { navigate, paths } from '../../lib/router';

const KIND: Record<AttentionKind, { icon: LucideIcon; tint: string }> = {
  'payment-reversed': { icon: Undo2, tint: 'bg-status-overdue-bg text-status-overdue-fg' },
  'quote-expiring': { icon: Clock, tint: 'bg-status-partial-bg text-status-partial-fg' },
  'below-cost': { icon: TrendingDown, tint: 'bg-status-overdue-bg text-status-overdue-fg' },
  'follow-up': { icon: PhoneCall, tint: 'bg-status-partial-bg text-status-partial-fg' },
  promise: { icon: HandCoins, tint: 'bg-status-partial-bg text-status-partial-fg' },
  occasion: { icon: CalendarHeart, tint: 'bg-brand-tint text-brand' },
};

function open(link: AttentionItem['link']) {
  if (link.to === 'customer') navigate(paths.customer(link.id));
  else if (link.to === 'proforma') navigate(paths.proforma(link.id));
  else if (link.to === 'design') navigate(paths.design(link.id));
  else navigate(paths.payments);
}

/** Things that quietly cost money if nobody looks: a payment that bounced, a quote about to lapse, a price below cost. Hidden when there are none. */
export function AttentionCard({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="animate-fade-up overflow-hidden shadow-card">
      <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
        <h2 className="text-base">Needs attention</h2>
        <span className="num rounded-full bg-status-overdue-bg px-2 py-0.5 text-xs text-status-overdue-fg">{items.length}</span>
      </div>
      <ul>
        {items.map((item) => {
          const { icon: Icon, tint } = KIND[item.kind];
          return (
            <li key={item.id} className="border-b border-line/70 last:border-0">
              <button type="button" onClick={() => open(item.link)} className="group flex w-full items-center gap-4 px-6 py-3 text-left transition-colors duration-150 hover:bg-canvas">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tint}`}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.title}</span>
                  <span className="block truncate text-xs text-ink-muted">{item.detail}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
