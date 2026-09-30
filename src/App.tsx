import { AppShell } from './components/Layout';
import { sectionOf, useRoute, type Route } from './lib/router';
import { CustomerPage } from './pages/customers/CustomerPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DesignPage } from './pages/inventory/DesignPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { AddSareesPage } from './pages/inventory/AddSareesPage';
import { MaterialsPage } from './pages/inventory/MaterialsPage';
import { InvoicePage } from './pages/invoices/InvoicePage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { NewInvoicePage } from './pages/invoices/NewInvoicePage';
import { PrintInvoicePage } from './pages/invoices/PrintInvoicePage';
import { CreditNotePage, CreditNotesPage } from './pages/invoices/CreditNotesPage';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { DuesPage, PaymentsPage } from './pages/payments/PaymentsPage';
import { ProformaPage } from './pages/proformas/ProformaPage';
import { ProformasPage } from './pages/proformas/ProformasPage';
import { ReportsPage } from './pages/reports/ReportsPage';
import { SettingsPage } from './pages/settings/SettingsPage';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'dashboard':
      return <DashboardPage />;
    case 'inventory':
      return <InventoryPage initialFilter={route.status} />;
    case 'materials':
      return <MaterialsPage />;
    case 'inventory-add':
      return <AddSareesPage />;
    case 'design':
      return <DesignPage id={route.id} />;
    case 'invoices':
      return <InvoicesPage initialStatus={route.status} />;
    case 'invoice-new':
      return <NewInvoicePage presetCustomerId={route.customerId} advance={route.advance} />;
    case 'payments':
      return <PaymentsPage />;
    case 'dues':
      return <DuesPage />;
    case 'invoice':
      return <InvoicePage id={route.id} />;
    case 'credit-notes':
      return <CreditNotesPage />;
    case 'credit-note':
      return <CreditNotePage id={route.id} />;
    case 'proformas':
      return <ProformasPage initialStatus={route.status} />;
    case 'proforma-new':
      return <NewInvoicePage mode="proforma" presetCustomerId={route.customerId} />;
    case 'proforma':
      return <ProformaPage id={route.id} />;
    case 'expenses':
      return <ExpensesPage category={route.category} />;
    case 'customers':
      return <CustomersPage />;
    case 'customer':
      return <CustomerPage id={route.id} />;
    case 'settings':
      return <SettingsPage section={route.section} />;
    case 'reports':
      return <ReportsPage tab={route.tab} period={route.period} asOf={route.asOf} />;
    case 'print-invoice':
    case 'print-proforma':
    case 'print-credit-note':
      return null; // rendered outside the app shell, see App()
  }
}

// Changing the key remounts the page, which replays its entrance animation on every navigation.
const pageKey = (r: Route): string => {
  switch (r.name) {
    case 'design':
    case 'invoice':
    case 'proforma':
    case 'customer':
    case 'credit-note':
    case 'print-invoice':
    case 'print-proforma':
    case 'print-credit-note':
      return `${r.name}:${r.id}`;
    case 'inventory':
    case 'invoices':
    case 'proformas':
      return `${r.name}:${r.status}`;
    case 'proforma-new':
      return `proforma-new:${r.customerId ?? ''}`;
    case 'invoice-new':
      return `new:${r.customerId ?? ''}:${r.advance?.amountPaise ?? 0}`;
    case 'settings':
      return 'settings'; // moving between sections keeps the page (and any unsaved edits) alive
    case 'reports':
      return `reports:${r.tab}`; // switching period stays on the same page instance, so the chart doesn't replay its entrance
    default:
      return r.name;
  }
};

export default function App() {
  const route = useRoute();
  // Print/PDF export render just the paper, with none of the app around it.
  if (route.name === 'print-invoice') return <PrintInvoicePage id={route.id} />;
  if (route.name === 'print-proforma') return <PrintInvoicePage id={route.id} kind="proforma" />;
  if (route.name === 'print-credit-note') return <PrintInvoicePage id={route.id} kind="credit-note" />;
  return (
    <AppShell active={sectionOf(route)} pageKey={pageKey(route)} hideFab={route.name === 'invoice-new' || route.name === 'proforma-new' || route.name === 'inventory-add'}>
      {renderRoute(route)}
    </AppShell>
  );
}
