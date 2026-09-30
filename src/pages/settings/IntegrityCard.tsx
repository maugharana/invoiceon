import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { IntegrityReport } from '../../../shared/types';
import { Button, ErrorNote } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, plural } from '../../lib/format';

/** "Check my books": runs the read only integrity checks and shows what agrees and what does not. Nothing is repaired automatically. */
export function IntegrityCard() {
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api.integrityCheck());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base">Check my books</h3>
          <p className="text-ink-muted">Looks at the records themselves: stock against its history, invoice arithmetic, payments, customer and supplier balances, invoice numbering, credit notes, and whether the activity log has been touched. It only reads; it never changes anything.</p>
        </div>
        <Button icon={<ShieldCheck className="h-4 w-4" />} loading={busy} onClick={() => void run()}>
          {report ? 'Check again' : 'Run the checks'}
        </Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {report && (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className={`flex items-center gap-2 px-4 py-2.5 ${report.problemCount === 0 ? 'bg-status-paid-bg text-status-paid-fg' : 'bg-status-overdue-bg text-status-overdue-fg'}`}>
            {report.problemCount === 0 ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <TriangleAlert className="h-4 w-4" aria-hidden />}
            {report.problemCount === 0 ? 'Everything adds up.' : `${plural(report.problemCount, 'problem')} found. Nothing has been changed.`}
            <span className="ml-auto text-xs opacity-80">Checked {formatDateTime(report.ranAt)}</span>
          </div>
          <ul className="divide-y divide-line/70">
            {report.checks.map((c) => (
              <li key={c.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  {c.problemCount === 0 ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> : <TriangleAlert className="h-4 w-4 shrink-0 text-status-overdue-fg" aria-hidden />}
                  <span className="flex-1">{c.title}</span>
                  <span className="num text-xs text-ink-muted">{c.problemCount === 0 ? `${c.checked} checked` : plural(c.problemCount, 'problem')}</span>
                </div>
                {c.problems.length > 0 && (
                  <ul className="ml-6 mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-status-overdue-fg">
                    {c.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                    {c.problemCount > c.problems.length && <li>and {c.problemCount - c.problems.length} more.</li>}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
