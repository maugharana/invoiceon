import { Award, PackageX } from 'lucide-react';
import { formatDate } from '../../../shared/gst';
import { formatMoney } from '../../../shared/money';
import type { DashboardOverview, DeadStock } from '../../../shared/types';
import { Card, EmptyState, Money } from '../../components/ui';
import { plural } from '../../lib/format';
import { navigate, paths } from '../../lib/router';

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b border-line px-6 py-4">
      <h2 className="text-base">{title}</h2>
      <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>
    </div>
  );
}

/** What sold best in the chosen period, by sales before GST. */
export function BestSellersCard({ sellers, scope }: { sellers: DashboardOverview['bestSellers']; scope: string }) {
  return (
    <Card className="overflow-hidden shadow-card">
      <Header title="Best sellers" sub={`By sales before GST · ${scope}`} />
      {sellers.length === 0 ? (
        <EmptyState icon={<Award className="h-6 w-6" />} title="No sales in this period" body="The designs that sell best will be ranked here." />
      ) : (
        <ol>
          {sellers.map((s, i) => (
            <li key={s.designId || s.name} className="border-b border-line/70 last:border-0">
              <button
                type="button"
                disabled={!s.designId}
                onClick={() => navigate(paths.design(s.designId))}
                className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors duration-150 enabled:hover:bg-canvas"
              >
                <span className="num w-4 text-xs text-ink-muted">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{s.name}</span>
                  <span className="num block text-xs text-ink-muted">{plural(s.pieces, 'piece')} sold</span>
                </span>
                <Money paise={s.revenuePaise} fractionDigits={0} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Pieces on the shelf that haven't sold for a long while: money sitting still, and the first candidates for a discount. */
export function DeadStockCard({ stock }: { stock: DeadStock }) {
  return (
    <Card className="overflow-hidden shadow-card">
      <Header
        title="Not selling"
        sub={stock.designCount === 0 ? `Nothing unsold for ${stock.days} days` : `${plural(stock.pieces, 'piece')} in ${plural(stock.designCount, 'design')} unsold for ${stock.days}+ days · ties up ${formatMoney(stock.costValuePaise, { fractionDigits: 0 })}`}
      />
      {stock.designs.length === 0 ? (
        <EmptyState icon={<PackageX className="h-6 w-6" />} title="Everything on the shelf is moving" body={`Designs with stock that hasn't sold in ${stock.days} days will show up here.`} />
      ) : (
        <ul>
          {stock.designs.map((d) => (
            <li key={d.designId} className="border-b border-line/70 last:border-0">
              <button type="button" onClick={() => navigate(paths.design(d.designId))} className="flex w-full items-center gap-4 px-6 py-3 text-left transition-colors duration-150 hover:bg-canvas">
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{d.name}</span>
                  <span className="num block text-xs text-ink-muted">
                    {plural(d.pieces, 'piece')} · {d.lastSoldOn ? `last sold ${formatDate(d.lastSoldOn)}` : 'never sold'}
                  </span>
                </span>
                <Money paise={d.costValuePaise} fractionDigits={0} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
