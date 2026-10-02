import { LabelSheet } from '../../components/LabelSheet';
import { PrintShell } from '../../components/PrintShell';
import { LABEL_LAYOUTS, type LabelLayout } from '../../../shared/types';
import { api } from '../../lib/api';
import { useQuery } from '../../lib/data';

/** The bare labels, with no app chrome. PDF export and printing open this route and capture it (see PrintShell). */
export function PrintLabelsPage({ items, layout }: { items: { variantId: string; copies: number }[]; layout: LabelLayout }) {
  const key = items.map((i) => `${i.variantId}:${i.copies}`).join(',');
  const query = useQuery(() => api.labelItems(items.map((i) => i.variantId)), [key]);
  if (query.error) return <p className="p-8 text-status-overdue-fg">{query.error}</p>;
  if (!query.data) return null;
  const byId = new Map(query.data.map((l) => [l.variantId, l]));
  const labels = items.flatMap((i) => (byId.has(i.variantId) ? Array.from({ length: i.copies }, () => byId.get(i.variantId)!) : []));
  return (
    <PrintShell bare ready title={`${labels.length} labels, ${LABEL_LAYOUTS[layout].label}`} noun="set of labels">
      <LabelSheet labels={labels} layout={layout} />
    </PrintShell>
  );
}
