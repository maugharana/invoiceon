import { useState, type FormEvent } from 'react';
import type { DesignDetail, DesignSummary } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { TagInput } from '../../components/TagInput';
import { SupplierSelect } from './MaterialModals';
import { Button, ErrorNote, Field, Input, MoneyInput, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import { buildDesignName, DEFAULT_OPTIONS } from '../../../shared/nomenclature';
import { tagCounts } from '../../../shared/tags';
import { ChoiceInput } from '../../components/ChoiceInput';

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
  const [weaveStyle, setWeaveStyle] = useState(design?.weaveStyle ?? '');
  const [technique, setTechnique] = useState(design?.technique ?? '');
  const [pattern, setPattern] = useState(design?.pattern ?? '');
  const [work, setWork] = useState(design?.work ?? '');
  const [hsn, setHsn] = useState(design?.hsnCode ?? '');
  const [price, setPrice] = useState(design?.defaultPricePaise ?? 0);
  const [gstRate, setGstRate] = useState(design?.gstRatePercent == null ? '' : String(design.gstRatePercent));
  const [description, setDescription] = useState(design?.description ?? '');
  const [tags, setTags] = useState(design?.tags ?? '');
  const [supplierId, setSupplierId] = useState(design?.supplierId ?? '');
  const everything = useQuery(() => api.designsList());
  const choices = useQuery(() => api.catalogueOptions());
  const lists = choices.data ?? DEFAULT_OPTIONS;
  const suggestedName = buildDesignName({ weaveStyle, fabric, technique, pattern, work, specialName: nickname.trim() });
  const suggestions = tagCounts((everything.data ?? []).map((d) => d.tags)).map((t) => t.tag);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const rate = gstRate.trim() === '' ? null : Number(gstRate);
    const input = { code, name, nickname: nickname.trim(), fabric, weaveStyle, technique, pattern, work, hsnCode: hsn, description, defaultPricePaise: price, gstRatePercent: rate, tags, supplierId: supplierId || null };
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
          <Field label="Design name" hint={name.trim() ? undefined : 'Leave empty to build it from the choices below.'}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || 'e.g. Banarasi Katan Silk Kadhua Saree'} data-autofocus />
            {suggestedName && suggestedName !== name.trim() && (
              <button type="button" onClick={() => setName(suggestedName)} className="mt-1 block text-left text-xs text-brand hover:underline">
                Use “{suggestedName}”
              </button>
            )}
          </Field>
        </div>
        <Field label="Special name" hint="Your own name for this saree, a word or a phrase, like “Lalima” or “Rang Bahar”. Optional. It goes last in the full name, and search finds it.">
          <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Lalima" maxLength={40} className="max-w-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Weave style">
            <ChoiceInput options={lists.weaveStyle} value={weaveStyle} onChange={setWeaveStyle} placeholder="Banarasi, Kanjivaram…" aria-label="Weave style" />
          </Field>
          <Field label="Fabric">
            <ChoiceInput options={lists.fabric} value={fabric} onChange={setFabric} placeholder="Katan Silk, Georgette…" aria-label="Fabric" />
          </Field>
          <Field label="Technique" hint="How it is woven">
            <ChoiceInput options={lists.technique} value={technique} onChange={setTechnique} placeholder="Kadhua, Phekua…" aria-label="Technique" />
          </Field>
          <Field label="Pattern" hint="Butidar or Jaal, one only">
            <ChoiceInput options={lists.pattern} value={pattern} onChange={setPattern} placeholder="Butidar, Jaal…" aria-label="Pattern" />
          </Field>
          <Field label="Special work" hint="You can pick more than one">
            <ChoiceInput multi options={lists.work} value={work} onChange={setWork} placeholder="Zardozi, Aari…" aria-label="Special work" />
          </Field>
          <Field label="HSN code" hint="Used on GST invoices">
            <Input value={hsn} onChange={(e) => setHsn(e.target.value)} inputMode="numeric" placeholder="5007" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Default selling price" hint="Before GST. Prefilled for each new variant; every variant can override it.">
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field label="GST rate for this design" hint="Leave empty to use your usual rate (or price slab) from Settings.">
            <div className="relative">
              <Input value={gstRate} onChange={(e) => setGstRate(e.target.value.replace(/[^\d.]/g, '').slice(0, 6))} inputMode="decimal" placeholder="Usual rate" className="num pr-8 text-right" />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted">%</span>
            </div>
          </Field>
        </div>
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
