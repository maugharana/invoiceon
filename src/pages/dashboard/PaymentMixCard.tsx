import { formatMoney } from '../../../shared/money';
import { PAYMENT_METHOD_LABEL, type DashboardOverview } from '../../../shared/types';
import { C_RECEIVED, ChartCard, RankedBars } from '../../components/charts';
import { plural } from '../../lib/format';

/** How the money arrived: cash, UPI, bank transfer… Useful for knowing what's in the till and what to expect in the bank. */
export function PaymentMixCard({ methods, scope }: { methods: DashboardOverview['receivedByMethod']; scope: string }) {
  const total = methods.reduce((s, m) => s + m.paise, 0);
  const share = (paise: number) => (total > 0 ? Math.round((paise / total) * 100) : 0);
  return (
    <ChartCard
      title="How customers paid"
      subtitle={`Payments received by method · ${scope}`}
      table={{ columns: ['Method', 'Payments', 'Received', 'Share'], rows: methods.map((m) => [PAYMENT_METHOD_LABEL[m.method], String(m.count), formatMoney(m.paise), `${share(m.paise)}%`]) }}
    >
      <RankedBars
        color={C_RECEIVED}
        rows={methods.map((m) => ({ key: m.method, label: PAYMENT_METHOD_LABEL[m.method], paise: m.paise, note: `${share(m.paise)}% · ${plural(m.count, 'payment')}` }))}
        empty={<>No payments received in this period.</>}
      />
    </ChartCard>
  );
}
