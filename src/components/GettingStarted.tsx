import { Check, Circle, X } from 'lucide-react';
import { ONBOARDING_LABEL, type OnboardingStepId } from '../../shared/onboarding';
import { api, errorMessage } from '../lib/api';
import { useQuery, useRefresh } from '../lib/data';
import { paths } from '../lib/router';
import { Card } from './ui';
import { useToast } from './Toast';

const HREF: Record<OnboardingStepId, string> = {
  profile: paths.settingsSection('business'),
  sarees: paths.addSarees,
  customers: '/customers/import',
  invoice: paths.newInvoice(),
  backup: paths.settingsSection('data'),
};

/**
 * The "Getting started" card at the top of the dashboard on a new installation. Each step ticks itself when the data shows it is done; the card
 * disappears by itself when all five are, or when the owner closes it.
 */
export function GettingStarted() {
  const toast = useToast();
  const refresh = useRefresh();
  const status = useQuery(() => api.onboardingStatus());
  const s = status.data;
  if (!s || s.dismissed) return null;
  const done = s.steps.filter((x) => x.done).length;
  if (done === s.steps.length) return null;

  return (
    <Card className="mb-8 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base">Getting started</h2>
          <p className="text-sm text-ink-muted">
            {done} of {s.steps.length} done. A few minutes now saves a lot of typing later.
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide getting started"
          title="Hide this"
          className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink"
          onClick={() => void api.onboardingDismiss().then(refresh, (err) => toast.error(errorMessage(err)))}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-status-neutral-bg" role="progressbar" aria-valuemin={0} aria-valuemax={s.steps.length} aria-valuenow={done}>
        <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(done / s.steps.length) * 100}%` }} />
      </div>
      <ul className="grid grid-cols-5 gap-3">
        {s.steps.map((step) => {
          const label = ONBOARDING_LABEL[step.id];
          return (
            <li key={step.id}>
              <a href={`#${HREF[step.id]}`} className={`flex h-full flex-col gap-1 rounded-lg border p-3 transition-colors duration-150 ${step.done ? 'border-line bg-canvas text-ink-muted' : 'border-line hover:border-brand/50 hover:bg-brand-tint'}`}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {step.done ? <Check className="h-4 w-4 text-brand" aria-hidden /> : <Circle className="h-4 w-4 text-ink-muted" aria-hidden />}
                  <span className={step.done ? 'line-through' : ''}>{label.title}</span>
                </span>
                <span className="text-xs text-ink-muted">{label.hint}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
