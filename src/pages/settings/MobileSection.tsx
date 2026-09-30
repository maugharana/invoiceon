import { Smartphone, Wifi } from 'lucide-react';
import { useState } from 'react';
import { QrCode } from '../../components/QrCode';
import { ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, ErrorNote, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';

/** The phone view: a read only page on the shop's Wi-Fi. Off until the owner switches it on. */
export function MobileSection() {
  const toast = useToast();
  const refresh = useRefresh();
  const status = useQuery(() => api.mobileStatus());
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [which, setWhich] = useState(0);
  const s = status.data;
  if (status.error && !s) return <ErrorNote>{status.error}</ErrorNote>;
  if (!s) return <Spinner />;

  async function toggle(on: boolean) {
    setBusy(true);
    try {
      if (on) await api.mobileEnable();
      else await api.mobileDisable();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const url = s.urls[Math.min(which, s.urls.length - 1)];

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex gap-3 rounded-lg bg-brand-tint p-4">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <p className="text-sm">
          See today's sales, who owes you and what is in stock from your phone, while you are away from the counter. It shows figures only: nothing can be changed from the phone, and costs and profit are never sent.
        </p>
      </div>

      {!s.enabled ? (
        <Button variant="primary" loading={busy} icon={<Wifi className="h-4 w-4" />} onClick={() => void toggle(true)}>
          Turn on the phone view
        </Button>
      ) : (
        <div className="space-y-4">
          {s.error && <ErrorNote>{s.error}</ErrorNote>}
          {url ? (
            <div className="flex items-start gap-5 rounded-lg border border-line p-4">
              <QrCode value={url} label="QR code for the phone view link" className="h-36 w-36 shrink-0 rounded-lg border border-line" />
              <div className="min-w-0 space-y-2">
                <p className="text-sm">
                  On a phone connected to the <span className="font-medium">same Wi-Fi</span>, scan this code with the camera, or type the address below.
                </p>
                <p className="num break-all rounded-lg bg-canvas px-3 py-2 text-xs">{url}</p>
                {s.urls.length > 1 && (
                  <p className="text-xs text-ink-muted">
                    This computer is on {s.urls.length} networks.{' '}
                    <button type="button" className="text-brand underline-offset-2 hover:underline" onClick={() => setWhich((w) => (w + 1) % s.urls.length)}>
                      Show the next address
                    </button>{' '}
                    if this one does not open.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <ErrorNote>The phone view is on but not answering. It starts when InvoiceOn is open on this computer.</ErrorNote>
          )}
          <div className="flex gap-2">
            <Button onClick={() => setResetting(true)}>Make a new link</Button>
            <Button loading={busy} onClick={() => void toggle(false)}>
              Turn off
            </Button>
          </div>
        </div>
      )}

      <ul className="list-disc space-y-1.5 pl-5 text-xs text-ink-muted">
        <li>It works only while InvoiceOn is open on this computer, and only on the shop's own network, not from outside.</li>
        <li>Anyone with the link can read these figures. Do not share it, and make a new link if a phone is lost or someone leaves: the old one stops working at once.</li>
        <li>The link is not encrypted on the way (it is a local address, not a website). Use it on your own Wi-Fi, not a public one.</li>
        <li>The first time, Windows may ask whether to let InvoiceOn use the network. Allow it on private networks.</li>
      </ul>

      {resetting && (
        <ConfirmDialog
          title="Make a new link?"
          confirmLabel="Make a new link"
          onClose={() => setResetting(false)}
          body={<p>The link on every phone stops working at once. Scan the new code on the phones that should keep seeing the figures.</p>}
          onConfirm={async () => {
            await api.mobileResetLink();
            refresh();
            setResetting(false);
            toast.success('New link made');
          }}
        />
      )}
    </div>
  );
}
