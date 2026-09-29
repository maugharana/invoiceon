import { CloudUpload, DollarSign, Lock, ShieldCheck, Smartphone, Users, type LucideIcon } from 'lucide-react';

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: CloudUpload, title: 'Access anywhere', body: 'Your invoices, clients and reports on any device with a browser.' },
  { icon: Smartphone, title: 'Real-time sync', body: 'Changes appear on all your devices at once. Start on the desktop, finish on your phone.' },
  { icon: Users, title: 'Team collaboration', body: 'Invite your team with role-based access, so everyone works from the same books.' },
  { icon: ShieldCheck, title: 'Encrypted & secure', body: 'End-to-end encryption for your financial data.' },
  { icon: DollarSign, title: 'Low subscription cost', body: 'Priced for small businesses and freelancers. No surprise fees.' },
];

/**
 * A preview of where InvoiceOn is headed. None of this exists yet — it all needs an online service — and the page says so
 * rather than dressing up a button that would go nowhere.
 */
export function PlusSection() {
  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-canvas px-3 py-2 text-ink-muted">
        InvoiceOn works fully offline today: your data lives on this computer. The features below need an online service, which isn't built yet. They are the plan for <span className="text-ink">InvoiceOn Plus</span>.
      </p>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-brand-ink p-4 xl:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <div key={title} style={{ ['--i' as string]: i } as React.CSSProperties} className="animate-fade-up stagger rounded-lg border border-white/10 bg-white/[0.04] p-5 transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.07]">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-[#7FD6BC]">
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <h3 className="mt-4 text-white">{title}</h3>
            <p className="mt-1 text-[#9DB8B0]">{body}</p>
          </div>
        ))}
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/15 p-5 text-center text-[#9DB8B0]">
          <Lock className="mb-2 h-5 w-5 text-[#7FD6BC]" aria-hidden />
          Not available yet
        </div>
      </div>
    </div>
  );
}
