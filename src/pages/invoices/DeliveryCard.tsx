import { Truck } from 'lucide-react';
import { useState } from 'react';
import { formatDate } from '../../../shared/gst';
import { DELIVERY_STATUS_LABEL, type DeliveryStatus, type Invoice } from '../../../shared/types';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, Input, Pill, Select } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useRefresh } from '../../lib/data';

const STATUSES = Object.keys(DELIVERY_STATUS_LABEL) as DeliveryStatus[];

/** Delivery progress for an issued invoice. Carrier and tracking can change after issue; the ship-to printed on it cannot. */
export function DeliveryCard({ invoice }: { invoice: Invoice }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<DeliveryStatus>(invoice.deliveryStatus);
  const [transport, setTransport] = useState(invoice.transport);
  const [tracking, setTracking] = useState(invoice.trackingNo);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.invoiceSetDelivery(invoice.id, { status, transport, trackingNo: tracking });
      refresh();
      setEditing(false);
      toast.success('Delivery updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const tone = invoice.deliveryStatus === 'delivered' ? 'paid' : invoice.deliveryStatus === 'dispatched' ? 'partial' : invoice.deliveryStatus === 'pending' ? 'overdue' : 'neutral';
  return (
    <Card className="mb-6 p-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base">
          <Truck className="h-4 w-4 text-ink-muted" aria-hidden /> Delivery
        </h2>
        {!editing && (
          <Button className="h-8 text-xs" onClick={() => setEditing(true)}>
            Update
          </Button>
        )}
      </div>
      {editing ? (
        <div className="grid grid-cols-[10rem_1fr_1fr_auto] items-end gap-3">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as DeliveryStatus)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DELIVERY_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transport / courier">
            <Input value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="e.g. Delhivery, Sharma Transport" />
          </Field>
          <Field label="Tracking / LR number">
            <Input value={tracking} onChange={(e) => setTracking(e.target.value)} className="num" />
          </Field>
          <div className="flex gap-2">
            <Button onClick={() => setEditing(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <Pill tone={tone}>{DELIVERY_STATUS_LABEL[invoice.deliveryStatus]}</Pill>
          {invoice.transport && <span className="text-ink-muted">{invoice.transport}</span>}
          {invoice.trackingNo && <span className="num text-ink-muted">#{invoice.trackingNo}</span>}
          {invoice.deliveredOn && <span className="text-ink-muted">on {formatDate(invoice.deliveredOn)}</span>}
          {invoice.shipTo && <span className="text-ink-muted">to {[invoice.shipTo.address, invoice.shipTo.city].filter(Boolean).join(', ')}</span>}
        </div>
      )}
    </Card>
  );
}
