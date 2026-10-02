import type { ProformaSummary } from './types';

/** The columns of the quotes board, left to right: how far each quote has got. */
export type PipelineColumn = 'waiting' | 'accepted' | 'partial' | 'invoiced' | 'closed';

export const PIPELINE_LABEL: Record<PipelineColumn, string> = {
  waiting: 'Waiting for an answer',
  accepted: 'Accepted',
  partial: 'Part-invoiced',
  invoiced: 'Invoiced',
  closed: 'Lost or lapsed',
};

export interface PipelineGroup {
  column: PipelineColumn;
  label: string;
  quotes: ProformaSummary[];
  totalPaise: number;
}

/** Which column a quote sits in. Withdrawn (cancelled) quotes are not on the board. */
export function pipelineColumn(q: Pick<ProformaSummary, 'status' | 'stage'>): PipelineColumn | null {
  switch (q.status) {
    case 'cancelled':
      return null;
    case 'converted':
      return 'invoiced';
    case 'partial':
      return 'partial';
    case 'lost':
    case 'expired':
      // A lapsed quote the customer had already accepted is still worth chasing, so it stays with the accepted ones.
      return q.status === 'expired' && q.stage === 'accepted' ? 'accepted' : 'closed';
    default:
      return q.stage === 'accepted' ? 'accepted' : 'waiting';
  }
}

/** Splits quotes into the board's columns, always all five, each with its total. Newest quote first within a column. */
export function buildPipeline(quotes: ProformaSummary[]): PipelineGroup[] {
  const order: PipelineColumn[] = ['waiting', 'accepted', 'partial', 'invoiced', 'closed'];
  const groups = new Map<PipelineColumn, PipelineGroup>(order.map((column) => [column, { column, label: PIPELINE_LABEL[column], quotes: [], totalPaise: 0 }]));
  for (const q of [...quotes].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))) {
    const column = pipelineColumn(q);
    if (!column) continue;
    const g = groups.get(column)!;
    g.quotes.push(q);
    g.totalPaise += q.totalPaise;
  }
  return order.map((c) => groups.get(c)!);
}
