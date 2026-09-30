import { useState } from 'react';
import { PIN_PATTERN } from '../../shared/access';
import { api, errorMessage } from '../lib/api';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { Button, ErrorNote, Field, Input } from './ui';

/** Lets whoever is signed in choose a new PIN for themselves. Needs the current PIN, so a walk-up at an unlocked screen can't change it. */
export function ChangePinDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = !PIN_PATTERN.test(newPin) ? 'The new PIN is 4 to 8 digits.' : newPin !== again ? 'The two new PINs do not match.' : null;

  async function save() {
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await api.accessChangePin(oldPin, newPin);
      toast.success('Your PIN is changed.');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Change my PIN"
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!oldPin} onClick={() => void save()}>
            Save new PIN
          </Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Current PIN">
          <Input type="password" inputMode="numeric" autoComplete="off" autoFocus maxLength={8} value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="New PIN" hint="4 to 8 digits.">
          <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
        </Field>
        <Field label="New PIN again">
          <Input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} />
        </Field>
      </form>
    </Modal>
  );
}
