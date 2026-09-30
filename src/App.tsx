import { Lock } from 'lucide-react';
import { useEffect } from 'react';
import { AppShell } from './components/Layout';
import { EmptyState } from './components/ui';
import { useAccess } from './lib/access';
import { navigate, paths, routeNeeds, sectionOf, useRoute, type Route } from './lib/router';
import { CustomerPage } from './pages/customers/CustomerPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { ImportCustomersPage } from './pages/customers/ImportCustomersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DesignPage } from './pages/inventory/DesignPage';
import { InventoryPage } from './pages/inventory/InventoryPage';
import { AddSareesPage } from './pages/inventory/AddSareesPage';
import { CataloguePage } from './pages/inventory/CataloguePage';
import { LabelsPage } from './pages/inventory/LabelsPage';
import { LocationsPage } from './pages/inventory/LocationsPage';
import { StockTakePage } from './pages/inventory/StockTakePage';
import { PrintCataloguePage } from './pages/inventory/PrintCataloguePage';
import { RestockPage } from './pages/inventory/RestockPage';
import { PrintLabelsPage } from './pages/inventory/PrintLabelsPage';
import { MaterialsPage } from './pages/inventory/MaterialsPage';
import { InvoicePage } from './pages/invoices/InvoicePage';
import { InvoicesPage } from './pages/invoices/InvoicesPage';
import { NewInvoicePage } from './pages/invoices/NewInvoicePage';
import { PrintInvoicePage } from './pages/invoices/PrintInvoicePage';
import { CreditNotePage, CreditNotesPage } from './pages/invoices/CreditNotesPage';
import { ExpensesPage } from './pages/expenses/ExpensesPage';
import { DuesPage, PaymentsPage } from './pages/payments/PaymentsPage';
import { BillPage } from './pages/purchases/BillPage';
import { NewBillPage } from './pages/purchases/NewBillPage';
import { PurchasesPage } from './pages/purchases/PurchasesPage';
import { SupplierPage } from './pages/purchases/SupplierPage';
import { SuppliersPage } from './pages/purchases/SuppliersPage';
import { JobOrderPage } from './pages/purchases/JobOrderPage';
import { WeaverPage } from './pages/purchases/WeaverPage';
import { WeaversPage } from './pages/purchases/WeaversPage';
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
    case 'labels':
      return <LabelsPage design={route.design} />;
    case 'catalogue':
      return <CataloguePage />;
    case 'restock':
      return <RestockPage />;
    case 'locations':
      return <LocationsPage />;
    case 'count':
      return <StockTakePage />;
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
    case 'purchases':
      return <PurchasesPage initialStatus={route.status} />;
    case 'bill-new':
      return <NewBillPage presetSupplierId={route.supplierId} />;
    case 'bill':
      return <BillPage id={route.id} />;
    case 'suppliers':
      return <SuppliersPage />;
    case 'supplier':
      return <SupplierPage id={route.id} />;
    case 'weavers':
      return <WeaversPage />;
    case 'weaver':
      return <WeaverPage id={route.id} />;
    case 'job-order':
      return <JobOrderPage id={route.id} />;
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
    case 'customers-import':
      return <ImportCustomersPage />;
    case 'customer':
      return <CustomerPage id={route.id} />;
    case 'settings':
      return <SettingsPage section={route.section} />;
    case 'reports':
      return <ReportsPage tab={route.tab} period={route.period} asOf={route.asOf} />;
    case 'print-invoice':
    case 'print-proforma':
    case 'print-credit-note':
    case 'print-labels':
    case 'print-catalogue':
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
    case 'bill':
    case 'supplier':
    case 'weaver':
    case 'job-order':
    case 'credit-note':
    case 'print-invoice':
    case 'print-proforma':
    case 'print-credit-note':
      return `${r.name}:${r.id}`;
    case 'labels':
      return `labels:${r.design ?? ''}`;
    case 'inventory':
    case 'invoices':
    case 'proformas':
      return `${r.name}:${r.status}`;
    case 'proforma-new':
      return `proforma-new:${r.customerId ?? ''}`;
    case 'purchases':
      return `purchases:${r.status}`;
    case 'bill-new':
      return `bill-new:${r.supplierId ?? ''}`;
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
  const { can } = useAccess();
  const allowed = can(routeNeeds(route));
  // Someone who may not see the dashboard lands on the invoices instead (the usual start of a counter shift).
  useEffect(() => {
    if (!allowed && route.name === 'dashboard') navigate(paths.invoices());
  }, [allowed, route.name]);
  // Print/PDF export render just the paper, with none of the app around it.
  if (route.name === 'print-invoice') return <PrintInvoicePage id={route.id} />;
  if (route.name === 'print-proforma') return <PrintInvoicePage id={route.id} kind="proforma" />;
  if (route.name === 'print-labels') return <PrintLabelsPage query={route.query} />;
  if (route.name === 'print-catalogue') return <PrintCataloguePage query={route.query} />;
  if (route.name === 'print-credit-note') return <PrintInvoicePage id={route.id} kind="credit-note" />;
  return (
    <AppShell active={sectionOf(route)} pageKey={pageKey(route)} hideFab={route.name === 'invoice-new' || route.name === 'proforma-new' || route.name === 'inventory-add' || route.name === 'bill-new'}>
      {allowed ? renderRoute(route) : <EmptyState icon={<Lock className="h-6 w-6" />} title="This page is not for your role" body="Ask the owner if you need to see it. Everything else in the menu is yours to use." />}
    </AppShell>
  );
}
