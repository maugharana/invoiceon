import type { ReactNode } from 'react';
import { PageHeader } from '../../components/ui';
import { useAccess } from '../../lib/access';
import { paths } from '../../lib/router';

const TABS = [
  { id: 'designs', label: 'Designs', href: paths.inventory() },
  { id: 'materials', label: 'Raw materials', href: paths.materials },
  { id: 'labels', label: 'Labels', href: paths.labels() },
  { id: 'catalogue', label: 'Catalogue', href: paths.catalogue },
  { id: 'restock', label: 'Restock', href: paths.restock },
] as const;

/** Shared header for the top-level inventory screens. */
export function InventoryShell({ tab, actions, children }: { tab: 'designs' | 'materials' | 'labels' | 'catalogue' | 'restock'; actions?: ReactNode; children: ReactNode }) {
  const { can } = useAccess();
  return (
    <>
      <PageHeader title="Inventory" subtitle="Saree designs, their colors and sizes, and what goes into making them." actions={actions} />
      <div className="mb-6 flex gap-6 border-b border-line" role="tablist">
        {TABS.filter((t) => t.id !== 'restock' || can('reports')).map((t) => (
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
