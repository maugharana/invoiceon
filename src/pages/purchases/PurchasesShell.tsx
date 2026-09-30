import type { ReactNode } from 'react';
import { PageHeader } from '../../components/ui';
import { paths } from '../../lib/router';

const TABS = [
  { id: 'bills', label: 'Bills', href: paths.purchases() },
  { id: 'suppliers', label: 'Suppliers', href: paths.suppliers },
] as const;

export type PurchasesTab = (typeof TABS)[number]['id'];

/** Shared header for the top level purchases screens. */
export function PurchasesShell({ tab, actions, children }: { tab: PurchasesTab; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <PageHeader title="Purchases" subtitle="What you buy from suppliers, what you owe them, and the GST you can claim back." actions={actions} />
      <div className="mb-6 flex gap-6 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.href}`}
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px border-b-2 pb-2.5 transition-colors duration-150 ${tab === t.id ? 'border-brand font-medium text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {t.label}
          </a>
        ))}
      </div>
      {children}
    </>
  );
}
