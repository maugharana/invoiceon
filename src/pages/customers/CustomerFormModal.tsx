import { useState, type FormEvent } from 'react';
import { isValidGstin } from '../../../shared/gst';
import { STATE_NAMES, stateFromGstin } from '../../../shared/states';
import type { Customer, InvoiceType } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, Segmented, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';

interface Props {
  /** Existing customer when editing. */
  customer?: Customer;
  /** Prefills the type for a new customer (e.g. when adding from a B2B invoice). */
  defaultType?: InvoiceType;
  defaultName?: string;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

export function CustomerFormModal({ customer, defaultType = 'B2C', defaultName = '', onClose, onSaved }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(customer?.name ?? defaultName);
  const [type, setType] = useState<InvoiceType>(customer?.type ?? defaultType);
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [gstin, setGstin] = useState(customer?.gstin ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [city, setCity] = useState(customer?.city ?? '');
  const [state, setState] = useState(customer?.state ?? '');
  const [pincode, setPincode] = useState(customer?.pincode ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function changeGstin(value: string) {
    const upper = value.toUpperCase().replace(/\s/g, '');
    setGstin(upper);
    // A complete, valid GSTIN tells us both that this is a business and which state it's in.
    if (isValidGstin(upper)) {
      setType('B2B');
      const derived = stateFromGstin(upper);
      if (derived && !state) setState(derived);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = { name, type, phone, email, gstin, address, city, state, pincode, notes };
    try {
      const saved = customer ? await api.customerUpdate(customer.id, input) : await api.customerCreate(input);
      refresh();
      toast.success(customer ? 'Customer updated' : `${saved.name} added`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={customer ? 'Edit customer' : 'New customer'}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="customer-form" loading={saving}>
            {customer ? 'Save changes' : 'Add customer'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] items-end gap-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Person or business name" data-autofocus />
          </Field>
          <Segmented
            label="Customer type"
            value={type}
            onChange={setType}
            options={[
              { value: 'B2C', label: 'B2C · Individual' },
              { value: 'B2B', label: 'B2B · Business' },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="GSTIN" hint={type === 'B2B' ? 'Needed for tax invoices' : 'Only if they have one'} error={gstin.length === 15 && !isValidGstin(gstin) ? 'This GSTIN doesn\'t look right' : undefined}>
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
          <Field label="State" hint="Decides CGST+SGST or IGST">
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
