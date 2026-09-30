import { useState } from 'react';
import { addDays, todayIso } from '../../../shared/gst';
import { CONTACT_LABEL, type ContactChannel } from '../../../shared/followup';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';

/** "I called them", and if they said they would pay on a day, "they promised": logged together, in one step. */
export function FollowUpDialog({ customerId, customerName, owedPaise, onClose }: { customerId: string; customerName: string; owedPaise: number; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [channel, setChannel] = useState<ContactChannel>('call');
  const [note, setNote] = useState('');
  const [promised, setPromised] = useState(false);
  const [day, setDay] = useState(addDays(todayIso(), 3));
  const [amount, setAmount] = useState(owedPaise);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (promised) await api.promiseCreate(customerId, { promisedOn: day, amountPaise: amount, note });
      await api.contactLog(customerId, channel, note);
      refresh();
      toast.success(promised ? 'Follow-up and promise saved' : 'Follow-up saved');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Follow up with ${customerName}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={promised && amount <= 0} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="How did you get in touch?">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as ContactChannel)}>
            {(['call', 'visit', 'whatsapp', 'other'] as const).map((c) => (
              <option key={c} value={c}>
                {CONTACT_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="What was said" hint="Optional.">
          <Input autoFocus value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Will pay after the wedding" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={promised} onChange={(e) => setPromised(e.target.checked)} /> They promised to pay
        </label>
        {promised && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="By">
              <Input type="date" className="num" value={day} min={todayIso()} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field label="Amount">
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
          </div>
        )}
      </form>
    </Modal>
  );
}
