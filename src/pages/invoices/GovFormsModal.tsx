import { useMemo, useState } from 'react';
import { eInvoiceFile, ewayBillFile, type EwayInput } from '../../../shared/govFiles';
import type { Invoice } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { Button, Field, Input, Select } from '../../components/ui';
import { toNumber } from '../../lib/format';
import { useCsvExport } from '../../lib/exportCsv';

type Kind = 'eway' | 'einvoice';

/** Prepares the file for the government's e-way bill or e-invoice portal. The numbers themselves are issued there, not here. */
export function GovFormsModal({ invoice: inv, kind: initial, onClose }: { invoice: Invoice; kind: Kind; onClose: () => void }) {
  const save = useCsvExport();
  const [kind, setKind] = useState<Kind>(initial);
  const [t, setT] = useState<EwayInput>({ mode: 'road', distanceKm: 0, transporterName: inv.transport, transporterId: '', transDocNo: inv.trackingNo, transDocDate: '', vehicleNo: '', vehicleType: 'regular' });
  const set = (patch: Partial<EwayInput>) => setT((v) => ({ ...v, ...patch }));
  const file = useMemo(() => (kind === 'eway' ? ewayBillFile(inv, t) : eInvoiceFile(inv)), [kind, inv, t]);
  const stem = `${inv.number.replace(/[^A-Za-z0-9]+/g, '-')}-${kind === 'eway' ? 'eway' : 'einvoice'}`;

  return (
    <Modal
      title="Government forms"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={file.problems.length > 0} onClick={() => void save(`${stem}.json`, file.json, 'File saved. Upload it on the portal.')}>
            Save file for upload
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2" role="tablist">
          <Button variant={kind === 'eway' ? 'primary' : 'secondary'} onClick={() => setKind('eway')}>E-way bill</Button>
          <Button variant={kind === 'einvoice' ? 'primary' : 'secondary'} onClick={() => setKind('einvoice')}>E-invoice</Button>
        </div>
        <p className="text-xs text-ink-muted">InvoiceOn prepares the file. The e-way bill number or e-invoice number (IRN) is issued by the government portal when you upload it.</p>
        {kind === 'eway' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mode">
              <Select value={t.mode} onChange={(e) => set({ mode: e.target.value as EwayInput['mode'] })}>
                <option value="road">Road</option>
                <option value="rail">Rail</option>
                <option value="air">Air</option>
                <option value="ship">Ship</option>
              </Select>
            </Field>
            <Field label="Distance (km)" hint="0 lets the portal work it out">
              <Input inputMode="numeric" value={String(t.distanceKm)} onChange={(e) => set({ distanceKm: toNumber(e.target.value) || 0 })} />
            </Field>
            <Field label="Transporter name">
              <Input value={t.transporterName} onChange={(e) => set({ transporterName: e.target.value })} />
            </Field>
            <Field label="Transporter GSTIN">
              <Input value={t.transporterId} onChange={(e) => set({ transporterId: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="LR or bilty number">
              <Input value={t.transDocNo} onChange={(e) => set({ transDocNo: e.target.value })} />
            </Field>
            <Field label="LR or bilty date">
              <Input type="date" value={t.transDocDate} onChange={(e) => set({ transDocDate: e.target.value })} />
            </Field>
            <Field label="Vehicle number">
              <Input value={t.vehicleNo} onChange={(e) => set({ vehicleNo: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Vehicle type">
              <Select value={t.vehicleType} onChange={(e) => set({ vehicleType: e.target.value as EwayInput['vehicleType'] })}>
                <option value="regular">Regular</option>
                <option value="oversize">Over dimensional</option>
              </Select>
            </Field>
          </div>
        )}
        {file.problems.length > 0 && (
          <div className="rounded-lg border border-status-overdue-fg/30 p-3 text-sm" role="alert">
            <div className="mb-1 font-medium">Fix these before uploading</div>
            <ul className="list-disc space-y-1 pl-5">{file.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {file.notes.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-ink-muted">{file.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </div>
    </Modal>
  );
}
