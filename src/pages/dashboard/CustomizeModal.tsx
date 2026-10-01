import { ArrowDown, ArrowUp } from 'lucide-react';
import { useState } from 'react';
import { DASHBOARD_SECTIONS, defaultLayout, moveSection, toggleSection, type DashboardLayout } from '../../../shared/dashboardLayout';
import { Modal } from '../../components/Modal';
import { Button, IconButton } from '../../components/ui';

const LABEL = new Map<string, { label: string; hint: string }>(DASHBOARD_SECTIONS.map((s) => [s.id, s]));

/** Choose which parts of the dashboard to show and put them in the order you want. Changes apply when you save. */
export function CustomizeModal({ layout, onSave, onClose }: { layout: DashboardLayout; onSave: (l: DashboardLayout) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(layout);
  const last = draft.order.length - 1;

  return (
    <Modal
      title="Customize your dashboard"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setDraft(defaultLayout())}>
            Reset to default
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-ink-muted">Tick what you want to see, and use the arrows to move a section up or down.</p>
      <ul className="divide-y divide-line/70 rounded-lg border border-line">
        {draft.order.map((id, i) => {
          const info = LABEL.get(id)!;
          const shown = !draft.hidden.includes(id);
          return (
            <li key={id} className="flex items-center gap-3 px-3 py-2.5">
              <input type="checkbox" checked={shown} onChange={() => setDraft(toggleSection(draft, id))} aria-label={`Show ${info.label}`} className="h-4 w-4 shrink-0 accent-[#0F6E56]" />
              <span className={`min-w-0 flex-1 ${shown ? '' : 'text-ink-muted'}`}>
                <span className="block truncate">{info.label}</span>
                <span className="block truncate text-xs text-ink-muted">{info.hint}</span>
              </span>
              <IconButton label={`Move ${info.label} up`} disabled={i === 0} className="disabled:opacity-30" onClick={() => setDraft(moveSection(draft, id, -1))}>
                <ArrowUp className="h-4 w-4" />
              </IconButton>
              <IconButton label={`Move ${info.label} down`} disabled={i === last} className="disabled:opacity-30" onClick={() => setDraft(moveSection(draft, id, 1))}>
                <ArrowDown className="h-4 w-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
