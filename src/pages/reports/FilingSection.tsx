import { Download, FileJson, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { type EwayTransport, type FilingFile, type FilingKind } from '../../../shared/filing';
import { todayIso } from '../../../shared/gst';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, Input, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';

const KINDS: { kind: FilingKind; title: string; blurb: string }[] = [
  { kind: 'gstr1', title: 'GSTR-1 return', blurb: 'Invoices, credit notes, HSN summary and document series, sorted into the sections the return asks for. Import it in the GST portal or the GST offline tool.' },
  { kind: 'einvoice', title: 'e-Invoice (IRN) file', blurb: 'Your B2B invoices and credit notes in the e-invoice layout, for bulk upload on the e-invoice portal. Needed only above the e-invoicing turnover limit.' },
  { kind: 'eway', title: 'e-Way bill file', blurb: 'Goods moving on an invoice above ₹50,000 need an e-way bill. Fill in the transport details if you have them, or leave them for the portal.' },
];

const blankTransport = (): EwayTransport => ({ mode: 'road', distanceKm: 0, vehicleNo: '', transporterName: '', transporterId: '', docNo: '', docDate: '' });

/** Files for the GST portals. InvoiceOn only prepares them: it never connects to a portal, and everything it noticed is listed before you upload. */
export function FilingSection({ range }: { range: { from: string; to: string } }) {
  const toast = useToast();
  const [busy, setBusy] = useState<FilingKind | null>(null);
  const [result, setResult] = useState<{ kind: FilingKind; file: FilingFile } | null>(null);
  const [transport, setTransport] = useState<EwayTransport>(blankTransport);
  const [which, setWhich] = useState<'limit' | 'all'>('limit');
  const set = <K extends keyof EwayTransport>(key: K, value: EwayTransport[K]) => setTransport((t) => ({ ...t, [key]: value }));

  async function prepare(kind: FilingKind) {
    setBusy(kind);
    try {
      const req = { kind, ...range } as Parameters<typeof api.gstFilingExport>[0];
      if (kind === 'eway') {
        const filled = transport.vehicleNo || transport.transporterName || transport.transporterId || transport.docNo || transport.distanceKm;
        if (filled) req.transport = { ...transport, docDate: transport.docNo ? transport.docDate || todayIso() : '' };
        if (which === 'all') req.invoiceIds = (await api.invoicesList()).filter((i) => i.status !== 'cancelled' && i.issueDate >= range.from && i.issueDate <= range.to).map((i) => i.id);
      }
      setResult({ kind, file: await api.gstFilingExport(req) });
    } catch (err) {
      toast.error(errorMessage(err));
      setResult(null);
    } finally {
      setBusy(null);
    }
  }

  async function save(file: FilingFile) {
    try {
      if (window.invoiceon) {
        if ((await api.exportSave(file.filename, file.content)).saved) toast.success('File saved');
      } else {
        const url = URL.createObjectURL(new Blob([file.content], { type: 'application/json' }));
        Object.assign(document.createElement('a'), { href: url, download: file.filename }).click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <section className="mb-8">
      <div className="mb-3">
        <h2 className="text-base">Files for the GST portals</h2>
        <p className="mt-0.5 text-xs text-ink-muted">Made from the invoices and credit notes in this period. Nothing is sent anywhere: you save the file and upload it yourself.</p>
      </div>
      <Card className="divide-y divide-line/70">
        {KINDS.map(({ kind, title, blurb }) => (
          <div key={kind} className="flex items-start gap-4 px-5 py-4">
            <FileJson className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div>{title}</div>
              <p className="text-xs text-ink-muted">{blurb}</p>
              {kind === 'eway' && (
                <div className="mt-3 grid max-w-2xl grid-cols-3 gap-3">
                  <Field label="Invoices">
                    <Select value={which} onChange={(e) => setWhich(e.target.value as 'limit' | 'all')}>
                      <option value="limit">Above the limit</option>
                      <option value="all">Every invoice</option>
                    </Select>
                  </Field>
                  <Field label="Travelling by">
                    <Select value={transport.mode} onChange={(e) => set('mode', e.target.value as EwayTransport['mode'])}>
                      <option value="road">Road</option>
                      <option value="rail">Rail</option>
                      <option value="air">Air</option>
                      <option value="ship">Ship</option>
                    </Select>
                  </Field>
                  <Field label="Distance (km)" hint="0 lets the portal work it out.">
                    <Input type="number" min={0} max={4000} className="num" value={transport.distanceKm} onChange={(e) => set('distanceKm', Math.max(0, Math.trunc(Number(e.target.value) || 0)))} />
                  </Field>
                  <Field label="Vehicle number">
                    <Input value={transport.vehicleNo} onChange={(e) => set('vehicleNo', e.target.value)} placeholder="UP53AB1234" />
                  </Field>
                  <Field label="Transporter">
                    <Input value={transport.transporterName} onChange={(e) => set('transporterName', e.target.value)} />
                  </Field>
                  <Field label="Transporter GSTIN">
                    <Input value={transport.transporterId} onChange={(e) => set('transporterId', e.target.value)} />
                  </Field>
                  <Field label="Transport document no.">
                    <Input value={transport.docNo} onChange={(e) => set('docNo', e.target.value)} />
                  </Field>
                  <Field label="Document date">
                    <Input type="date" value={transport.docDate} onChange={(e) => set('docDate', e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
            <Button loading={busy === kind} onClick={() => void prepare(kind)}>
              Prepare
            </Button>
          </div>
        ))}
      </Card>

      {result && (
        <Card className="mt-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base">{KINDS.find((k) => k.kind === result.kind)?.title} is ready</h3>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-muted">
                {result.file.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <Button variant="primary" icon={<Download className="h-4 w-4" />} disabled={result.file.count === 0} onClick={() => void save(result.file)}>
              Save {result.file.filename.length > 28 ? 'file' : result.file.filename}
            </Button>
          </div>
          {result.file.warnings.length > 0 && (
            <div className="mt-4 rounded-lg bg-status-partial-bg p-3 text-sm text-status-partial-fg">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <TriangleAlert className="h-4 w-4" aria-hidden /> Check before you upload
              </div>
              <ul className="list-disc space-y-0.5 pl-5">
                {result.file.warnings.slice(0, 12).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {result.file.warnings.length > 12 && <li>and {result.file.warnings.length - 12} more.</li>}
              </ul>
            </div>
          )}
        </Card>
      )}
    </section>
  );
}
