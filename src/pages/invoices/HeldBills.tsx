import { useState } from 'react';
import { type InvoiceDraft, parseInvoiceDraft } from '../../../shared/invoiceDraft';
import type { HeldBill } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { plural } from '../../lib/format';

/** Names a half-made bill and sets it aside, so the counter is free for the next customer. */
export function HoldModal({ suggestion, draft, onHeld, onClose }: { suggestion: string; draft: InvoiceDraft; onHeld: () => void; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(suggestion);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api.heldHold({ name, kind: 'invoice', payload: draft });
      refresh();
      toast.success(`“${name.trim()}” is on hold`);
      onHeld();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Hold this bill"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!name.trim()} onClick={() => void submit()}>
            Put on hold
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-ink-muted">
          {plural(draft.lines.length, 'item')} set aside as they are. Nothing is issued and no stock moves; pick it up again from “On hold” when the customer is ready.
        </p>
        <Field label="Name it so you can find it">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void submit()} />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </div>
    </Modal>
  );
}

/** The bills on hold, to resume or throw away. */
export function HeldListModal({ onResume, onClose }: { onResume: (bill: HeldBill, draft: InvoiceDraft) => void; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const held = useQuery(() => api.heldList('invoice'));
  const [busy, setBusy] = useState<string | null>(null);

  async function discard(b: HeldBill) {
    setBusy(b.id);
    try {
      await api.heldDiscard(b.id);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Bills on hold" size="sm" onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {held.loading ? (
        <Spinner />
      ) : (held.data?.length ?? 0) === 0 ? (
        <p className="py-6 text-center text-ink-muted">Nothing on hold.</p>
      ) : (
        <ul className="divide-y divide-line/70">
          {held.data!.map((b) => {
            const draft = parseInvoiceDraft(b.payload);
            return (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate">{b.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {draft ? plural(draft.lines.length, 'item') : 'Could not be read'} · {new Date(b.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <Button className="h-8 text-xs" disabled={busy === b.id} onClick={() => void discard(b)}>
                    Discard
                  </Button>
                  {draft && (
                    <Button
                      variant="primary"
                      className="h-8 text-xs"
                      disabled={busy === b.id}
                      onClick={async () => {
                        setBusy(b.id);
                        try {
                          await api.heldDiscard(b.id); // picked up: it is no longer on hold
                          refresh();
                          onResume(b, draft);
                        } catch (err) {
                          toast.error(errorMessage(err));
                          setBusy(null);
                        }
                      }}
                    >
                      Resume
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
