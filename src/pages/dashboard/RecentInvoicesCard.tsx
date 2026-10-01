import { ChevronRight, FileText } from 'lucide-react';
import { formatDate } from '../../../shared/gst';
import type { DashboardOverview } from '../../../shared/types';
import { Card, EmptyState, InvoicePill, Money, TypePill } from '../../components/ui';
import { navigate, paths } from '../../lib/router';

export function RecentInvoicesCard({ invoices, loaded }: { invoices: DashboardOverview['recent']; loaded: boolean }) {
  return (
    <Card className="overflow-hidden shadow-card">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="text-base">Recent invoices</h2>
        {invoices.length > 0 && (
          <a href={`#${paths.invoices()}`} className="text-brand transition-colors hover:text-brand-hover">
            View all
          </a>
        )}
      </div>
      {loaded && invoices.length === 0 ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No invoices yet" body="Invoices you issue will appear here with their payment status." />
      ) : (
        <ul>
          {invoices.map((i) => (
            <li key={i.id} className="animate-fade-in border-b border-line/70 last:border-0">
              <button type="button" onClick={() => navigate(paths.invoice(i.id))} className="group flex w-full items-center gap-4 px-6 py-3.5 text-left transition-colors duration-150 hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="num">{i.number}</span>
                    {i.type === 'B2B' && <TypePill type="B2B" />}
                  </div>
                  <div className="truncate text-xs text-ink-muted">
                    {i.buyerName} · <span className="num">{formatDate(i.issueDate)}</span>
                  </div>
                </div>
                <Money paise={i.totalPaise} className={i.status === 'cancelled' ? 'text-ink-muted line-through' : ''} />
                <span className="w-24 text-right">
                  <InvoicePill status={i.status} />
                </span>
                <ChevronRight className="h-4 w-4 text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
