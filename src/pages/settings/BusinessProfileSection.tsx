import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { isValidGstin } from '../../../shared/gst';
import { STATE_NAMES } from '../../../shared/states';
import { Button, ErrorNote, Field, Input, Select } from '../../components/ui';
import { errorMessage } from '../../lib/api';
import { logoFromFile } from '../../lib/image';
import type { SectionProps } from './draft';

export function BusinessProfileSection({ draft, set }: SectionProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  async function chooseLogo(file: File | undefined) {
    if (!file) return;
    try {
      set('invoiceLogo', await logoFromFile(file));
      setLogoError(null);
    } catch (err) {
      setLogoError(errorMessage(err));
    } finally {
      if (fileInput.current) fileInput.current.value = ''; // so choosing the same file again still fires
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-muted">Business logo</div>
        <div className="flex items-center gap-4">
          <div className="flex h-24 w-48 items-center justify-center rounded-lg border border-dashed border-line bg-canvas">
            {draft.invoiceLogo ? <img src={draft.invoiceLogo} alt="Your logo" className="max-h-20 max-w-44 object-contain" /> : <span className="text-xs text-ink-muted">No logo yet</span>}
          </div>
          <div className="flex flex-col items-start gap-2">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => void chooseLogo(e.target.files?.[0])} />
            <Button icon={<ImagePlus className="h-4 w-4" />} onClick={() => fileInput.current?.click()}>
              {draft.invoiceLogo ? 'Change logo' : 'Choose logo'}
            </Button>
            {draft.invoiceLogo && (
              <button type="button" onClick={() => set('invoiceLogo', '')} className="inline-flex items-center gap-1.5 text-xs text-ink-muted transition-colors hover:text-status-overdue-fg">
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </button>
            )}
            <p className="text-xs text-ink-muted">PNG, JPG, WebP or SVG. It's shrunk automatically.</p>
          </div>
        </div>
        {logoError && (
          <div className="mt-3">
            <ErrorNote>{logoError}</ErrorNote>
          </div>
        )}
      </div>

      <Field label="Business name">
        <Input value={draft.businessName} onChange={(e) => set('businessName', e.target.value)} />
      </Field>
      <Field label="Your name" hint="You, the owner. Not printed on invoices.">
        <Input value={draft.ownerName} onChange={(e) => set('ownerName', e.target.value)} autoComplete="name" />
      </Field>
      <Field label="Country" hint="InvoiceOn handles GST, so India is the only country for now.">
        <Select value={draft.country} onChange={(e) => set('country', e.target.value)}>
          <option>India</option>
        </Select>
      </Field>
      <Field label="Address">
        <Input value={draft.addressLine} onChange={(e) => set('addressLine', e.target.value)} placeholder="Street, area" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="City">
          <Input value={draft.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="State" hint="Buyers in this state pay CGST + SGST; others pay IGST">
          <Select value={draft.state} onChange={(e) => set('state', e.target.value)}>
            <option value="">Not set</option>
            {STATE_NAMES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Postal code">
          <Input value={draft.pincode} onChange={(e) => set('pincode', e.target.value)} maxLength={6} inputMode="numeric" className="num" />
        </Field>
        <Field label="GSTIN" hint="Required to issue B2B tax invoices" error={draft.gstin.length === 15 && !isValidGstin(draft.gstin) ? "This GSTIN doesn't look right" : undefined}>
          <Input value={draft.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={15} placeholder="09ABCDE1234F1Z5" className="num" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Phone">
          <Input value={draft.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Email">
          <Input type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
