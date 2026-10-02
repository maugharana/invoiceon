import { Percent } from 'lucide-react';
import { formatMoney } from '../../../shared/money';
import type { DashboardMonth } from '../../../shared/types';
import { Money } from '../../components/ui';
import { navigate, paths } from '../../lib/router';
import { StatCard } from './StatCard';

/**
 * GST for this month: what was charged on the invoices, less the GST paid on purchases (entered on expenses). With no input GST
 * recorded it is simply the tax charged, and the card says so.
 */
export function GstCard({ month, index }: { month: DashboardMonth; index: number }) {
  const parts = [
    month.cgstPaise > 0 && `CGST ${formatMoney(month.cgstPaise, { fractionDigits: 0 })}`,
    month.sgstPaise > 0 && `SGST ${formatMoney(month.sgstPaise, { fractionDigits: 0 })}`,
    month.igstPaise > 0 && `IGST ${formatMoney(month.igstPaise, { fractionDigits: 0 })}`,
  ].filter(Boolean);
  const monthName = new Date(`${month.range.from}T00:00:00`).toLocaleDateString('en-IN', { month: 'long' });
  return (
    <StatCard
      index={index}
      label={`GST · ${monthName}`}
      icon={Percent}
      value={<Money paise={Math.abs(month.netGstPaise)} fractionDigits={0} />}
      sub={
        month.inputGstPaise > 0
          ? `Charged ${formatMoney(month.gstPaise, { fractionDigits: 0 })} less ${formatMoney(month.inputGstPaise, { fractionDigits: 0 })} paid on purchases`
          : parts.length
            ? parts.join(' · ')
            : 'No tax charged yet this month'
      }
      delta={<span className="text-xs text-ink-muted">{month.netGstPaise < 0 ? 'Credit to carry forward' : month.inputGstPaise > 0 ? 'Left to pay' : 'Before any input credit'}</span>}
      onClick={() => navigate(paths.reports('gst', { preset: 'this-month' }))}
    />
  );
}
