import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatMoney } from '../../../shared/money';
import type { CompareWith } from '../../../shared/periods';
import type { DashboardOverview } from '../../../shared/types';
import { Money } from '../../components/ui';
import { navigate, paths } from '../../lib/router';
import { Delta, StatCard } from './StatCard';

/** What the business kept: sales before GST, less what the pieces cost, less what was spent. */
export function ProfitCard({ overview: o, compare, scope, index }: { overview: DashboardOverview; compare: CompareWith; scope: string; index: number }) {
  const loss = o.netProfitPaise < 0;
  const money = (paise: number) => formatMoney(paise, { fractionDigits: 0 });
  return (
    <StatCard
      index={index}
      label={loss ? 'Loss' : 'Profit'}
      icon={loss ? TrendingDown : TrendingUp}
      tone={loss ? 'red' : 'brand'}
      value={<Money paise={Math.abs(o.netProfitPaise)} fractionDigits={0} />}
      sub={
        o.invoiceCount === 0 && o.expensesPaise === 0
          ? `No sales or expenses · ${scope}`
          : `${money(o.grossProfitPaise)} gross${o.marginPercent === null ? '' : ` (${Math.round(o.marginPercent)}% margin)`} − ${money(o.expensesPaise)} spent`
      }
      delta={o.previous ? <Delta now={o.netProfitPaise} before={o.previous.netProfitPaise} compare={compare} /> : <span className="text-xs text-ink-muted">{scope}</span>}
      onClick={() => navigate(paths.reports('sales'))}
    />
  );
}
