import { Bell, Building2, ClipboardList, CreditCard, Database, FileText, Gift, KeyRound, Percent, Smartphone, ScrollText, Send, Settings2, Sparkles, Tag, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useToast } from '../../components/Toast';
import { Button, Card, ErrorNote, PageHeader, Spinner } from '../../components/ui';
import { api, errorMessage } from '../../lib/api';
import { useQuery, useRefresh } from '../../lib/data';
import type { SettingsSection } from '../../lib/router';
import { paths } from '../../lib/router';
import { AccessSection } from './AccessSection';
import { ActivitySection } from './ActivitySection';
import { BusinessProfileSection } from './BusinessProfileSection';
import { DataManagementSection } from './DataManagementSection';
import { fromDraft, toDraft, type Draft, type SetDraft } from './draft';
import { ExpenseCategoriesSection } from './ExpenseCategoriesSection';
import { InvoiceSection } from './InvoiceSection';
import { MobileSection } from './MobileSection';
import { OffersSection } from './OffersSection';
import { NotificationsSection } from './NotificationsSection';
import { PaymentAccountsSection } from './PaymentAccountsSection';
import { PaymentInstructionsSection } from './PaymentInstructionsSection';
import { PlusSection } from './PlusSection';
import { PreferencesSection } from './PreferencesSection';
import { ProformaSection } from './ProformaSection';
import { SharingSection } from './SharingSection';
import { TaxProfilesSection } from './TaxProfilesSection';

interface SectionInfo {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  /** Sections that are actions rather than fields have nothing to save. */
  saves: boolean;
}

const SECTIONS: SectionInfo[] = [
  { id: 'business', label: 'Business Profile', icon: Building2, title: 'Business Profile', subtitle: 'Update your business information. It is printed at the top of every invoice.', saves: true },
  { id: 'tax', label: 'Tax Profiles', icon: Percent, title: 'Tax Profiles', subtitle: 'The GST rate charged on your invoices.', saves: true },
  { id: 'invoice', label: 'Invoice Settings', icon: FileText, title: 'Invoice Settings', subtitle: 'Numbering, terms and how your invoices and PDFs look. The preview updates as you type.', saves: true },
  { id: 'proforma', label: 'Proforma Settings', icon: ClipboardList, title: 'Proforma Settings', subtitle: 'Defaults for proforma invoices (quotes).', saves: true },
  { id: 'expenses', label: 'Expense Categories', icon: Tag, title: 'Expense Categories', subtitle: 'The headings you file business expenses under.', saves: true },
  { id: 'accounts', label: 'Payment Accounts', icon: Wallet, title: 'Payment Accounts', subtitle: 'Where customers’ money lands: banks, UPI, cash.', saves: true },
  { id: 'instructions', label: 'Payment Instructions', icon: CreditCard, title: 'Payment Instructions', subtitle: 'How customers should pay you, printed on each invoice.', saves: true },
  { id: 'sharing', label: 'Sharing & UPI', icon: Send, title: 'Sharing & UPI', subtitle: 'Your UPI id for the pay QR code, and the messages sent with invoices and reminders.', saves: true },
  { id: 'offers', label: 'Offers & Loyalty', icon: Gift, title: 'Offers & Loyalty', subtitle: 'Discount offers and loyalty points for your regular customers.', saves: false },
  { id: 'notifications', label: 'Notifications', icon: Bell, title: 'Notifications', subtitle: 'What InvoiceOn points out to you.', saves: true },
  { id: 'data', label: 'Data Management', icon: Database, title: 'Data Management', subtitle: 'Where your data is, and keeping it safe.', saves: false },
  { id: 'mobile', label: 'Phone View', icon: Smartphone, title: 'Phone View', subtitle: 'Check sales, dues and stock from your phone, on the shop Wi-Fi. Read only.', saves: false },
  { id: 'access', label: 'Users & Access', icon: KeyRound, title: 'Users & Access', subtitle: 'Who can sign in, and what each person can do.', saves: true },
  { id: 'activity', label: 'Activity Log', icon: ScrollText, title: 'Activity Log', subtitle: 'What was done, when and by whom. It cannot be edited.', saves: false },
  { id: 'preferences', label: 'Preferences', icon: Settings2, title: 'Preferences', subtitle: 'Defaults used across the app.', saves: true },
  { id: 'plus', label: 'InvoiceOn Plus', icon: Sparkles, title: 'InvoiceOn Plus', subtitle: 'Sync, teams and access from anywhere: what is planned.', saves: false },
];

function renderSection(id: SettingsSection, draft: Draft, set: SetDraft): ReactNode {
  switch (id) {
    case 'business':
      return <BusinessProfileSection draft={draft} set={set} />;
    case 'tax':
      return <TaxProfilesSection draft={draft} set={set} />;
    case 'invoice':
      return <InvoiceSection draft={draft} set={set} />;
    case 'proforma':
      return <ProformaSection draft={draft} set={set} />;
    case 'expenses':
      return <ExpenseCategoriesSection draft={draft} set={set} />;
    case 'accounts':
      return <PaymentAccountsSection draft={draft} set={set} />;
    case 'instructions':
      return <PaymentInstructionsSection draft={draft} set={set} />;
    case 'sharing':
      return <SharingSection draft={draft} set={set} />;
    case 'offers':
      return <OffersSection />;
    case 'notifications':
      return <NotificationsSection draft={draft} set={set} />;
    case 'data':
      return <DataManagementSection />;
    case 'mobile':
      return <MobileSection />;
    case 'access':
      return <AccessSection draft={draft} set={set} />;
    case 'activity':
      return <ActivitySection />;
    case 'preferences':
      return <PreferencesSection draft={draft} set={set} />;
    case 'plus':
      return <PlusSection />;
  }
}

export function SettingsPage({ section }: { section: SettingsSection }) {
  const toast = useToast();
  const refresh = useRefresh();
  const settings = useQuery(() => api.getSettings());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Take the first load as the starting draft; later refetches (after saving) don't clobber typing.
  useEffect(() => {
    if (settings.data && !draft) setDraft(toDraft(settings.data));
  }, [settings.data, draft]);

  // A message about one section shouldn't follow you to another.
  useEffect(() => setError(null), [section]);

  if (!draft) return settings.error ? <ErrorNote>{settings.error}</ErrorNote> : <Spinner />;

  const info = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;
  const set: SetDraft = (key, value) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const dirty = !!settings.data && JSON.stringify(draft) !== JSON.stringify(toDraft(settings.data));

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveSettings(fromDraft(draft, true));
      setDraft(toDraft(saved));
      refresh();
      toast.success('Settings saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your business, your invoices, your data."
        actions={
          <>
            {dirty && <span className="text-xs text-ink-muted">Unsaved changes</span>}
            {(info.saves || dirty) && (
              <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>
                Save changes
              </Button>
            )}
          </>
        }
      />

      <div className="flex items-start gap-8">
        <nav aria-label="Settings" className="sticky top-0 w-52 shrink-0">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => {
              const active = s.id === section;
              return (
                <li key={s.id}>
                  <a
                    href={`#${paths.settingsSection(s.id)}`}
                    aria-current={active ? 'page' : undefined}
                    className={`flex h-10 items-center gap-3 border-l-2 px-3 transition-colors duration-150 ${active ? 'border-brand bg-brand-tint font-medium text-brand' : 'border-transparent text-ink-muted hover:bg-ink/5 hover:text-ink'}`}
                  >
                    <s.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                    <span className="truncate">{s.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <Card className="min-w-0 flex-1 p-6">
          {/* Keyed so each section eases in when you switch. */}
          <div key={info.id} className="animate-fade-in">
            <h2 className="text-xl tracking-tight">{info.title}</h2>
            <p className="mb-6 mt-1 text-ink-muted">{info.subtitle}</p>
            {error && (
              <div className="mb-5">
                <ErrorNote>{error}</ErrorNote>
              </div>
            )}
            {renderSection(info.id, draft, set)}
          </div>
        </Card>
      </div>
    </>
  );
}
