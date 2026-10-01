import { Percent } from 'lucide-react';
import { formatMoney } from '../../../shared/money';
import type { DashboardMonth } from '../../../shared/types';
import { Money } from '../../components/ui';
import { navigate, paths } from '../../lib/router';
import { StatCard } from './StatCard';

/**
 * GST charged on this month's invoices: what falls due to the government on the invoices dated this month. Credit for tax paid on
 * purchases isn't tracked yet, so this is the tax before any credit, and the card says so.
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
      value={<Money paise={month.gstPaise} fractionDigits={0} />}
      sub={parts.length ? parts.join(' · ') : 'No tax charged yet this month'}
      delta={<span className="text-xs text-ink-muted">Before input credit</span>}
      onClick={() => navigate(paths.reports('gst', { preset: 'this-month' }))}
    />
  );
}
