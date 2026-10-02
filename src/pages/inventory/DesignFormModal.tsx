import { useState, type FormEvent } from 'react';
import type { DesignDetail, DesignSummary } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { TagInput } from '../../components/TagInput';
import { SupplierSelect } from './MaterialModals';
import { Button, ErrorNote, Field, Input, MoneyInput, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { tagCounts } from '../../../shared/tags';

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
  const [nickname, setNickname] = useState(design?.nickname ?? '');
  const [fabric, setFabric] = useState(design?.fabric ?? '');
  const [hsn, setHsn] = useState(design?.hsnCode ?? '');
  const [price, setPrice] = useState(design?.defaultPricePaise ?? 0);
  const [description, setDescription] = useState(design?.description ?? '');
  const [tags, setTags] = useState(design?.tags ?? '');
  const [supplierId, setSupplierId] = useState(design?.supplierId ?? '');
  const everything = useQuery(() => api.designsList());
  const suggestions = tagCounts((everything.data ?? []).map((d) => d.tags)).map((t) => t.tag);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input = { code, name, nickname: nickname.trim(), fabric, hsnCode: hsn, description, defaultPricePaise: price, tags, supplierId: supplierId || null };
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Banarasi Katan Kadhua" data-autofocus />
          </Field>
        </div>
        <Field label="Short name" hint="A special one-word name for this saree, like “Kadhua”. Optional. Search finds it." error={/\s/.test(nickname.trim()) ? 'Use one word, with no spaces' : undefined}>
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Kadhua" maxLength={20} className="max-w-[12rem]" />
        </Field>
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
        <Field label="Default selling price" hint="Before GST. Prefilled for each new variant; every variant can override it.">
          <MoneyInput value={price} onChange={setPrice} />
        </Field>
        <SupplierSelect value={supplierId} onChange={setSupplierId} label="Usually made or bought from" hint="Used to split your reorder list by who to order from" />
        <Field label="Tags" hint="Collection, occasion or season: bridal, festive, summer…">
          <TagInput value={tags} onChange={setTags} suggestions={suggestions} placeholder="bridal, festive" />
        </Field>
        <Field label="Notes">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weave, border, motifs… (optional)" />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Modal>
  );
}
