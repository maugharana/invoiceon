import type { ReactNode } from 'react';
import { PageHeader } from '../../components/ui';
import { paths } from '../../lib/router';

const TABS = [
  { id: 'designs', label: 'Designs', href: paths.inventory() },
  { id: 'materials', label: 'Raw materials', href: paths.materials },
  { id: 'production', label: 'Production', href: paths.production },
  { id: 'weaver', label: 'Weaver orders', href: paths.weaverOrders },
] as const;

/** Shared header for the two top-level inventory screens. */
export function InventoryShell({ tab, actions, children }: { tab: 'designs' | 'materials' | 'production' | 'weaver'; actions?: ReactNode; children: ReactNode }) {
  return (
    <>
      <PageHeader title="Inventory" subtitle="Saree designs, their colors and sizes, and what goes into making them." actions={actions} />
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
