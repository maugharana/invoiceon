import { Check, ClipboardCopy, FolderOpen, Mail, MessageCircle, X } from 'lucide-react';
import { useState } from 'react';
import { invoiceMessage, mailtoLink, whatsappLink, whatsappPhone } from '../../../shared/messages';
import type { Invoice, SharedFile } from '../../../shared/types';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, Input, Textarea } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { copyText } from '../../lib/clipboard';

/** Set when an invoice has just been issued, so its page offers to send it. Read once and cleared. */
export const JUST_ISSUED_KEY = 'invoiceon.justIssued';

/**
 * Sending an invoice to the customer. In the desktop app the PDF is made and copied for you, so after the chat or message opens a
 * single Ctrl+V attaches it. WhatsApp and email programs don't take a file from another program any other way, so that paste is the
 * one step left to the person; in a plain browser there is no shell to make the file, and they are told to save it themselves.
 */
export function useShareInvoice(inv: Invoice) {
  const toast = useToast();
  const [busy, setBusy] = useState<'whatsapp' | 'email' | 'file' | null>(null);
  const [file, setFile] = useState<SharedFile | null>(null);
  const desktop = !!window.invoiceon;

  async function prepare(): Promise<SharedFile | null> {
    if (!desktop) return null;
    try {
      const made = await api.invoiceShareFile(inv.id);
      setFile(made);
      return made;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  }

  return {
    busy,
    desktop,
    async whatsApp(rawPhone: string, body: string) {
      const phone = whatsappPhone(rawPhone);
      if (!phone) return toast.error('Enter the customer’s phone number: 10 digits, or with the country code.');
      setBusy('whatsapp');
      const made = await prepare();
      window.open(whatsappLink(phone, body), '_blank');
      toast.info(made?.copied ? 'WhatsApp opened. The PDF is copied: click in the chat, press Ctrl+V to attach it, then Send.' : desktop ? 'WhatsApp opened with the message. Use “Show the PDF” to attach the file.' : 'WhatsApp opened with the message. Save the PDF and attach it before you send.');
      setBusy(null);
    },
    async email(to: string, subject: string, body: string) {
      setBusy('email');
      const made = await prepare();
      window.open(mailtoLink(to, subject, body), '_blank');
      toast.info(made?.copied ? 'Your mail program opened. The PDF is copied: click in the message, press Ctrl+V to attach it, then Send.' : desktop ? 'Your mail program opened with the message. Use “Show the PDF” to attach the file.' : 'Your mail program opened with the message. Save the PDF and attach it before you send.');
      setBusy(null);
    },
    async copyMessage(subject: string, body: string) {
      if (await copyText(`${subject}\n\n${body}`)) toast.success('Message copied — paste it anywhere');
      else toast.error('Couldn’t copy to the clipboard');
    },
    async showFile() {
      setBusy('file');
      const made = file ?? (await prepare());
      if (made) {
        try {
          await api.shareReveal(made.path);
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }
      setBusy(null);
    },
  };
}

/** The message that goes with an invoice, from the shop's own wording (Settings → Message templates) or the standard one. */
const messageFor = (inv: Invoice, template: string) => invoiceMessage(inv, { name: inv.seller.name, upiId: inv.seller.upiId }, template);

/** Shown right after an invoice is issued: send it to the customer in one tap, or leave it for later. */
export function JustIssuedCard({ inv, email, template, onMore, onDismiss }: { inv: Invoice; email: string; template: string; onMore: () => void; onDismiss: () => void }) {
  const share = useShareInvoice(inv);
  const message = messageFor(inv, template);
  const phone = inv.buyer.phone ?? '';
  const canWhatsApp = !!whatsappPhone(phone);
  if (!canWhatsApp && !email) return null;
  const first = inv.buyerName.split(' ')[0];
  return (
    <Card className="animate-fade-up mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-brand/30 bg-brand-tint/60 p-4">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white">
        <Check className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{inv.number} is issued</p>
        <p className="text-xs text-ink-muted">Send it to {first} now. {share.desktop ? 'The PDF is made and copied for you; paste it into the chat with Ctrl+V.' : 'Save the PDF to attach it.'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canWhatsApp && (
          <Button variant="primary" icon={<MessageCircle className="h-4 w-4" />} loading={share.busy === 'whatsapp'} disabled={share.busy !== null} onClick={() => void share.whatsApp(phone, message.body)}>
            WhatsApp
          </Button>
        )}
        {email && (
          <Button icon={<Mail className="h-4 w-4" />} loading={share.busy === 'email'} disabled={share.busy !== null} onClick={() => void share.email(email, message.subject, message.body)}>
            Email
          </Button>
        )}
        <Button onClick={onMore}>More ways…</Button>
        <button type="button" aria-label="Not now" title="Not now" onClick={onDismiss} className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-ink/5 hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
    </Card>
  );
}

/** Sending an invoice with the message shown and editable first, by WhatsApp or email, to a number or address that can be changed here. */
export function ShareInvoiceModal({ inv, email: savedEmail, template, onClose }: { inv: Invoice; email: string; template: string; onClose: () => void }) {
  const share = useShareInvoice(inv);
  const standard = messageFor(inv, template);
  const [body, setBody] = useState(standard.body);
  const [subject, setSubject] = useState(standard.subject);
  const [phone, setPhone] = useState(inv.buyer.phone ?? '');
  const [email, setEmail] = useState(savedEmail);

  return (
    <Modal title={`Send ${inv.number}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-ink-muted">
          {share.desktop ? 'Choose how to send it. The PDF is made and copied, so once the chat or message opens, click in it and press Ctrl+V to attach the file.' : 'This opens WhatsApp or your mail program with the message ready. Save the PDF first (Save PDF on the invoice) and attach it before you send.'}
        </p>

        <Field label="Message">
          <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <button type="button" onClick={() => { setBody(standard.body); setSubject(standard.subject); }} className="-mt-3 text-xs text-brand transition-colors hover:text-brand-hover">
          Back to the standard message
        </button>

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="WhatsApp number">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" className="num" />
          </Field>
          <Button variant="primary" icon={<MessageCircle className="h-4 w-4" />} loading={share.busy === 'whatsapp'} disabled={share.busy !== null} onClick={() => void share.whatsApp(phone, body)}>
            Open WhatsApp
          </Button>
        </div>

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <div className="space-y-3">
            <Field label="Email address">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@example.com" />
            </Field>
            <Field label="Subject">
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </Field>
          </div>
          <Button icon={<Mail className="h-4 w-4" />} loading={share.busy === 'email'} disabled={share.busy !== null || !email.trim()} onClick={() => void share.email(email, subject, body)}>
            Open email
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button icon={<ClipboardCopy className="h-4 w-4" />} onClick={() => void share.copyMessage(subject, body)}>
            Copy the message
          </Button>
          {share.desktop && (
            <Button icon={<FolderOpen className="h-4 w-4" />} loading={share.busy === 'file'} disabled={share.busy !== null} onClick={() => void share.showFile()} title="Show the PDF in its folder, to drag into a chat or an email">
              Show the PDF
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
