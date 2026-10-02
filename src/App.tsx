import { AppShell } from './components/Layout';
import { useEffect } from 'react';
import { ROLE_HOME } from '../shared/roles';
import { useAuth } from './lib/auth';
import { SignInScreen } from './pages/SignInScreen';
import { navigate, sectionOf, useRoute, type Route } from './lib/router';
import { CustomerPage } from './pages/customers/CustomerPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DesignPage } from './pages/inventory/DesignPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { AddSareesPage } from './pages/inventory/AddSareesPage';
import { TidyNamesPage } from './pages/inventory/TidyNamesPage';
import { WeaverOrderEditPage } from './pages/inventory/WeaverOrderEditPage';
import { WeaverOrderPage } from './pages/inventory/WeaverOrderPage';
import { WeaverOrdersPage } from './pages/inventory/WeaverOrdersPage';
import { MaterialsPage } from './pages/inventory/MaterialsPage';
import { ProductionPage } from './pages/inventory/ProductionPage';
import { StockTakePage } from './pages/inventory/StockTakePage';
import { CreditNotePage, CreditNotesPage } from './pages/invoices/CreditNotePages';
import { PrintLabelsPage } from './pages/inventory/Labels';
import { QuickBillPage } from './pages/invoices/QuickBillPage';
import { InvoicePage } from './pages/invoices/InvoicePage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { NewInvoicePage } from './pages/invoices/NewInvoicePage';
import { PrintCreditNotePage, PrintInvoicePage, PrintInvoicesPage, PrintSlipPage } from './pages/invoices/PrintInvoicePage';
import { PrintReceiptPage, PrintStatementPage } from './pages/PrintOtherPages';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { AccountsPage, ChequesPage, ReconcilePage } from './pages/payments/MoneyPages';
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
    case 'inventory-names':
      return <TidyNamesPage />;
    case 'weaver-orders':
      return <WeaverOrdersPage />;
    case 'weaver-order-new':
      return <WeaverOrderEditPage quoteId={route.quoteId} />;
    case 'weaver-order-edit':
      return <WeaverOrderEditPage editId={route.id} />;
    case 'weaver-order':
      return <WeaverOrderPage id={route.id} />;
    case 'production':
      return <ProductionPage />;
    case 'inventory-add':
      return <AddSareesPage />;
    case 'stock-take':
      return <StockTakePage />;
    case 'design':
      return <DesignPage id={route.id} />;
    case 'invoices':
      return <InvoicesPage initialStatus={route.status} />;
    case 'invoice-new':
      return <NewInvoicePage presetCustomerId={route.customerId} advance={route.advance} copyFrom={route.copyFrom} />;
    case 'payments':
      return <PaymentsPage />;
    case 'dues':
      return <DuesPage />;
    case 'notifications':
      return <NotificationsPage />;
    case 'cheques':
      return <ChequesPage />;
    case 'accounts':
      return <AccountsPage />;
    case 'reconcile':
      return <ReconcilePage />;
    case 'invoice':
      return <InvoicePage id={route.id} />;
    case 'quick-bill':
      return <QuickBillPage />;
    case 'credit-notes':
      return <CreditNotesPage />;
    case 'credit-note':
      return <CreditNotePage id={route.id} />;
    case 'proformas':
      return <ProformasPage initialStatus={route.status} />;
    case 'proforma-new':
      return <NewInvoicePage mode="proforma" presetCustomerId={route.customerId} copyFrom={route.copyFrom} />;
    case 'proforma-edit':
      return <NewInvoicePage mode="proforma" presetCustomerId={null} editId={route.id} />;
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
    case 'print-statement':
    case 'print-receipt':
    case 'print-credit-note':
    case 'print-labels':
    case 'print-slip':
    case 'print-invoices':
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
      return `${r.name}:${r.id}`;
    case 'inventory':
    case 'invoices':
    case 'proformas':
      return `${r.name}:${r.status}`;
    case 'weaver-order-new':
      return `weaver-order-new:${r.quoteId ?? ''}`;
    case 'weaver-order-edit':
    case 'weaver-order':
      return `${r.name}:${r.id}`;
    case 'proforma-new':
      return `proforma-new:${r.customerId ?? ''}:${r.copyFrom ?? ''}`;
    case 'proforma-edit':
      return `proforma-edit:${r.id}`;
    case 'invoice-new':
      return `new:${r.customerId ?? ''}:${r.advance?.amountPaise ?? 0}:${r.copyFrom ?? ''}`;
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
  const auth = useAuth();
  // Typing the address of a part of the app your role does not have sends you home instead of showing an error.
  const user = auth.status?.user;
  const shut = !!auth.status?.required && !!user && !auth.canOpen(sectionOf(route));
  useEffect(() => {
    if (shut && user) navigate(ROLE_HOME[user.role]);
  }, [shut, user]);
  // A shop that uses sign-in sees nothing, not even the print pages, until someone has signed in.
  if (!auth.status) return null;
  if (auth.status.required && !auth.status.user) return <SignInScreen />;
  if (shut) return null;
  // Print/PDF export render just the paper, with none of the app around it.
  if (route.name === 'print-invoice') return <PrintInvoicePage id={route.id} />;
  if (route.name === 'print-proforma') return <PrintInvoicePage id={route.id} kind="proforma" />;
  if (route.name === 'print-statement') return <PrintStatementPage customerId={route.id} />;
  if (route.name === 'print-receipt') return <PrintReceiptPage paymentId={route.id} />;
  if (route.name === 'print-slip') return <PrintSlipPage id={route.id} />;
  if (route.name === 'print-labels') return <PrintLabelsPage items={route.items} />;
  if (route.name === 'print-credit-note') return <PrintCreditNotePage id={route.id} />;
  if (route.name === 'print-invoices') return <PrintInvoicesPage ids={route.ids} />;
  return (
    <AppShell active={sectionOf(route)} pageKey={pageKey(route)} hideFab={route.name === 'invoice-new' || route.name === 'quick-bill' || route.name === 'proforma-new' || route.name === 'proforma-edit' || route.name === 'inventory-add' || route.name === 'inventory-names' || route.name === 'weaver-order-new' || route.name === 'weaver-order-edit' || route.name === 'stock-take'}>
      {renderRoute(route)}
    </AppShell>
  );
}
