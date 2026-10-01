import { GO_SHORTCUTS, OTHER_SHORTCUTS } from '../../shared/shortcuts';
import { Modal } from './Modal';
import { Button } from './ui';

const Key = ({ children }: { children: string }) => <kbd className="num inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md border border-line bg-canvas px-1.5 text-xs">{children}</kbd>;

/** The keyboard shortcuts, opened with "?". */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" size="md" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-6">
        <section>
          <h3 className="mb-2 text-xs font-medium text-ink-muted">Go to a page: press G, then a letter</h3>
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2">
            {GO_SHORTCUTS.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3">
                <span>{s.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Key>G</Key>
                  <Key>{s.key.toUpperCase()}</Key>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3 className="mb-2 text-xs font-medium text-ink-muted">Anywhere</h3>
          <ul className="space-y-2">
            {OTHER_SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-center justify-between gap-3">
                <span>{s.label}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {s.keys.split(' ').map((k) => (
                    <Key key={k}>{k}</Key>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-xs text-ink-muted">Shortcuts pause while you are typing in a box.</p>
      </div>
    </Modal>
  );
}
