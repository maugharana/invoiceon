import { useState, type FormEvent } from 'react';
import type { DesignDetail, DesignSummary } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Field, Input, MoneyInput, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { toNumber } from '../../lib/format';

const FABRICS = ['Pure silk', 'Katan silk', 'Silk blend', 'Cotton silk', 'Cotton', 'Organza', 'Georgette', 'Linen', 'Tissue'];

interface Props {
  /** Existing design when editing; omitted when creating. */
  design?: DesignSummary;
  /** Suggested code for a new design. */
  suggestedCode?: string;
  onClose: () => void;
  onSaved: (design: DesignDetail) => void;
}

export function DesignFormModal({ design, suggestedCode = '', onClose, onSaved }: Props) {
  const toast = useToast();
  const refresh = useRefresh();
  const [code, setCode] = useState(design?.code ?? suggestedCode);
  const [name, setName] = useState(design?.name ?? '');
  const [fabric, setFabric] = useState(design?.fabric ?? '');
  const [hsn, setHsn] = useState(design?.hsnCode ?? '');
  const [price, setPrice] = useState(design?.defaultPricePaise ?? 0);
  const [description, setDescription] = useState(design?.description ?? '');
  const [rate, setRate] = useState(design?.gstRatePercent == null ? '' : String(design.gstRatePercent));
  const settings = useQuery(() => api.getSettings());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const parsedRate = toNumber(rate);
    if (rate.trim() !== '' && Number.isNaN(parsedRate)) {
      setError('GST rate must be a number, or left blank.');
      setSaving(false);
      return;
    }
    const input = { code, name, fabric, hsnCode: hsn, description, defaultPricePaise: price, gstRatePercent: rate.trim() === '' ? null : parsedRate };
    try {
      const saved = design ? await api.designUpdate(design.id, input) : await api.designCreate(input);
      refresh();
      toast.success(design ? 'Design updated' : `${saved.name} added — now add its colors and sizes`);
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={design ? 'Edit design' : 'New design'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="design-form" loading={saving}>
            {design ? 'Save changes' : 'Add design'}
          </Button>
        </>
      }
    >
      <form id="design-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[9rem_1fr] gap-4">
          <Field label="Design code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MG-001" />
          </Field>
          <Field label="Design name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mau Silk Butidar" data-autofocus />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Fabric">
            <Input value={fabric} onChange={(e) => setFabric(e.target.value)} list="fabric-options" placeholder="Pure silk" />
            <datalist id="fabric-options">
              {FABRICS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <Field label="HSN code" hint="Used on GST invoices">
            <Input value={hsn} onChange={(e) => setHsn(e.target.value)} inputMode="numeric" placeholder="5007" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Default selling price" hint="Before GST. Prefilled for each new variant; every variant can override it.">
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field
            label="GST rate %"
            hint={settings.data ? (settings.data.gstSlabsEnabled ? 'Blank: charged by price step (Settings, Tax Profiles).' : `Blank: your usual ${settings.data.gstRatePercent}%.`) : 'Blank: your usual rate.'}
          >
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Usual rate" className="num text-right" />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weave, border, motifs… (optional)" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
