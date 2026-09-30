import { useState, type FormEvent } from 'react';
import { isValidGstin } from '../../../shared/gst';
import { STATE_NAMES, stateFromGstin } from '../../../shared/states';
import type { Supplier } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';

interface Props {
  supplier?: Supplier;
  defaultName?: string;
  onClose: () => void;
  onSaved: (supplier: Supplier) => void;
}

export function SupplierFormModal({ supplier, defaultName = '', onClose, onSaved }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(supplier?.name ?? defaultName);
  const [gstin, setGstin] = useState(supplier?.gstin ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [state, setState] = useState(supplier?.state ?? '');
  const [pincode, setPincode] = useState(supplier?.pincode ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function changeGstin(value: string) {
    const upper = value.toUpperCase().replace(/\s/g, '');
    setGstin(upper);
    if (isValidGstin(upper)) {
      const derived = stateFromGstin(upper);
      if (derived && !state) setState(derived);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = { name, gstin, phone, email, address, city, state, pincode, notes };
    try {
      const saved = supplier ? await api.supplierUpdate(supplier.id, input) : await api.supplierCreate(input);
      refresh();
      toast.success(supplier ? 'Supplier updated' : `${saved.name} added`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={supplier ? 'Edit supplier' : 'New supplier'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="supplier-form" loading={saving}>
            {supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </>
      }
    >
      <form id="supplier-form" onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Person or business name" data-autofocus />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="GSTIN" hint="Needed to claim the GST on their bills back" error={gstin.length === 15 && !isValidGstin(gstin) ? "This GSTIN doesn't look right" : undefined}>
            <Input value={gstin} onChange={(e) => changeGstin(e.target.value)} placeholder="09ABCDE1234F1Z5" maxLength={15} className="num uppercase" />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" />
          </Field>
        </div>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area" />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="State" hint="Decides CGST+SGST or IGST on their bills">
            <Select value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">Not set</option>
              {STATE_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Pincode">
            <Input value={pincode} onChange={(e) => setPincode(e.target.value)} inputMode="numeric" maxLength={6} className="num" />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything worth remembering (optional)" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
