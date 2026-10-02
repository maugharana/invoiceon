import { Check, ChevronRight, X } from 'lucide-react';
import type { OnboardingStep } from '../../../shared/onboarding';
import { Card } from '../../components/ui';
import { navigate } from '../../lib/router';

/** The first things to do in a new book, ticked off by what is really in it. Goes away when everything is done, or when dismissed. */
export function OnboardingCard({ steps, onDismiss }: { steps: OnboardingStep[]; onDismiss: () => void }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <Card className="animate-fade-up mb-6 overflow-hidden shadow-card">
      <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
        <div>
          <h2 className="text-base">Getting started</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            <span className="num">{done}</span> of <span className="num">{steps.length}</span> done
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-status-neutral-bg sm:block" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done} aria-label="Getting started progress">
            <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
          </div>
          <button type="button" onClick={onDismiss} aria-label="Hide the getting started list" title="Hide this list" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <ul>
        {steps.map((s) => (
          <li key={s.id} className="border-b border-line/70 last:border-0">
            <button type="button" disabled={s.done} onClick={() => navigate(s.path)} className="group flex w-full items-center gap-4 px-6 py-3 text-left transition-colors duration-150 enabled:hover:bg-canvas disabled:cursor-default">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${s.done ? 'border-brand bg-brand text-white' : 'border-line text-transparent'}`}>
                <Check className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block ${s.done ? 'text-ink-muted line-through' : ''}`}>{s.label}</span>
                {!s.done && <span className="block text-xs text-ink-muted">{s.hint}</span>}
              </span>
              {!s.done && <ChevronRight className="h-4 w-4 shrink-0 text-ink-muted/50 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
