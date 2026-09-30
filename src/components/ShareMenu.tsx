import { Mail, MessageCircle, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { mailtoUrl, whatsappNumber, whatsappUrl } from '../../shared/share';
import { Button } from './ui';

export interface ShareOption {
  id: string;
  label: string;
  hint?: string;
  kind: 'whatsapp' | 'email';
  /** Phone for WhatsApp, address for email. */
  to: string;
  subject?: string;
  message: string;
}

/**
 * "Share" button with a small menu: send a prepared message on WhatsApp or by email. WhatsApp cannot be handed a file, so the message
 * says where the invoice is and the PDF is attached by hand (Save PDF, then attach): that is stated in the menu rather than hidden.
 */
export function ShareMenu({ options, onShared }: { options: ShareOption[]; onShared?: (option: ShareOption) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const go = (o: ShareOption) => {
    const url = o.kind === 'whatsapp' ? whatsappUrl(o.to, o.message) : mailtoUrl(o.to, o.subject ?? '', o.message);
    window.open(url, '_blank', 'noopener');
    setOpen(false);
    onShared?.(o);
  };

  return (
    <div ref={root} className="relative">
      <Button icon={<Send className="h-4 w-4" />} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Share
      </Button>
      {open && (
        <div role="menu" className="animate-pop-in absolute right-0 z-30 mt-1.5 w-80 rounded-lg border border-line bg-surface p-1.5 shadow-overlay">
          {options.map((o) => {
            const missing = o.kind === 'whatsapp' ? !whatsappNumber(o.to) : !o.to;
            return (
              <button key={o.id} type="button" role="menuitem" onClick={() => go(o)} className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-canvas">
                {o.kind === 'whatsapp' ? <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden /> : <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />}
                <span>
                  <span className="block">{o.label}</span>
                  <span className="block text-xs text-ink-muted">{missing ? (o.kind === 'whatsapp' ? 'No phone number on file: you will choose the contact.' : 'No email on file: you will type the address.') : (o.hint ?? o.to)}</span>
                </span>
              </button>
            );
          })}
          <p className="border-t border-line px-3 pb-1.5 pt-2 text-xs text-ink-muted">To send the invoice itself, use Save PDF and attach it to the message.</p>
        </div>
      )}
    </div>
  );
}
