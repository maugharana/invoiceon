import { Plus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { tagCounts } from '../../../shared/tags';
import { isValidGstin } from '../../../shared/gst';
import { STATE_NAMES, stateFromGstin } from '../../../shared/states';
import type { Customer, CustomerAddress, CustomerContact, InvoiceType } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { TagInput } from '../../components/TagInput';
import { Button, ErrorNote, Field, IconButton, Input, MoneyInput, Segmented, Select, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

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
  const [tags, setTags] = useState(customer?.tags ?? '');
  const [creditLimit, setCreditLimit] = useState(customer?.creditLimitPaise ?? 0);
  const [terms, setTerms] = useState(customer?.paymentTermsDays == null ? '' : String(customer.paymentTermsDays));
  const [birthday, setBirthday] = useState(customer?.birthday ?? '');
  const [anniversary, setAnniversary] = useState(customer?.anniversary ?? '');
  const [addresses, setAddresses] = useState<CustomerAddress[]>(customer?.addresses ?? []);
  const [contacts, setContacts] = useState<CustomerContact[]>(customer?.contacts ?? []);
  const [more, setMore] = useState(!!customer && (customer.tags !== '' || customer.creditLimitPaise > 0 || customer.paymentTermsDays != null || customer.birthday !== '' || customer.anniversary !== '' || customer.addresses.length > 0 || customer.contacts.length > 0));
  const existing = useQuery(() => api.customersList());
  const suggestions = tagCounts((existing.data ?? []).map((c) => c.tags)).map((t) => t.tag);
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
    const input = {
      name, type, phone, email, gstin, address, city, state, pincode, notes, tags, creditLimitPaise: creditLimit,
      paymentTermsDays: terms.trim() === '' ? null : Number(terms),
      birthday, anniversary, addresses, contacts,
    };
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

        {!more ? (
          <button type="button" onClick={() => setMore(true)} className="text-sm text-brand transition-colors hover:text-brand-hover">
            + Tags, credit limit, payment terms, birthday, more addresses and contacts
          </button>
        ) : (
          <div className="space-y-4 border-t border-line pt-4">
            <Field label="Tags" hint="Group customers: bridal, wholesale, regular…">
              <TagInput value={tags} onChange={setTags} suggestions={suggestions} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Credit limit" hint="Warns when an invoice takes them past this. Leave 0 for none.">
                <MoneyInput value={creditLimit} onChange={setCreditLimit} />
              </Field>
              <Field label="Payment terms (days)" hint="Their invoices fall due this many days after the invoice date">
                <Input value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="Shop default" className="num" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Birthday" hint="You'll get a reminder a few days before">
                <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="num" />
              </Field>
              <Field label="Anniversary">
                <Input type="date" value={anniversary} onChange={(e) => setAnniversary(e.target.value)} className="num" />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Other addresses</span>
                <Button type="button" className="h-8 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddresses([...addresses, { label: '', address: '', city: '', state: '', pincode: '' }])}>
                  Add address
                </Button>
              </div>
              {addresses.map((a, i) => (
                <div key={i} className="grid grid-cols-[8rem_1fr_9rem_auto] items-center gap-2 rounded-lg border border-line p-2">
                  <Input value={a.label} placeholder="Label (Home, Shop)" onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  <Input value={a.address} placeholder="Street, area" onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} />
                  <Input value={a.city} placeholder="City" onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, city: e.target.value } : x)))} />
                  <IconButton label="Remove address" type="button" onClick={() => setAddresses(addresses.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </IconButton>
                  <Select className="col-span-2" value={a.state} onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, state: e.target.value } : x)))}>
                    <option value="">State not set</option>
                    {STATE_NAMES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  <Input value={a.pincode} placeholder="Pincode" maxLength={6} className="num" onChange={(e) => setAddresses(addresses.map((x, j) => (j === i ? { ...x, pincode: e.target.value } : x)))} />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Other contacts</span>
                <Button type="button" className="h-8 text-xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setContacts([...contacts, { name: '', role: '', phone: '', email: '' }])}>
                  Add contact
                </Button>
              </div>
              {contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_7rem_9rem_auto] items-center gap-2 rounded-lg border border-line p-2">
                  <Input value={c.name} placeholder="Name" onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <Input value={c.role} placeholder="Role" onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />
                  <Input value={c.phone} placeholder="Phone" inputMode="tel" onChange={(e) => setContacts(contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
                  <IconButton label="Remove contact" type="button" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
