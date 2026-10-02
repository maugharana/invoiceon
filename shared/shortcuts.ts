/** Keyboard shortcuts that work anywhere in the app. "Go to" shortcuts are two keys in a row: press G, then a letter. */
export interface GoShortcut {
  key: string;
  label: string;
  path: string;
}

export const GO_SHORTCUTS: GoShortcut[] = [
  { key: 'd', label: 'Dashboard', path: '/dashboard' },
  { key: 'i', label: 'Invoices', path: '/invoices' },
  { key: 'q', label: 'Proformas (quotes)', path: '/proformas' },
  { key: 'c', label: 'Customers', path: '/customers' },
  { key: 's', label: 'Inventory (stock)', path: '/inventory' },
  { key: 'm', label: 'Raw materials', path: '/inventory/materials' },
  { key: 'p', label: 'Payments', path: '/payments' },
  { key: 'o', label: 'Dues (who owes)', path: '/payments/dues' },
  { key: 'e', label: 'Expenses', path: '/expenses' },
  { key: 'r', label: 'Reports', path: '/reports/sales' },
  { key: 't', label: 'Settings', path: '/settings' },
];

export const OTHER_SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Ctrl K', label: 'Search anything, or create something' },
  { keys: 'Ctrl N', label: 'New invoice' },
  { keys: 'Ctrl Shift N', label: 'Open a second window (desktop app)' },
  { keys: '?', label: 'Show this list' },
  { keys: 'Esc', label: 'Close a window or the search' },
];

/** How long after G the next key still counts. */
export const CHORD_MS = 1200;

/** The page a "G then letter" chord leads to, or null if the letter isn't one of them. */
export function goTarget(key: string): GoShortcut | null {
  return GO_SHORTCUTS.find((s) => s.key === key.toLowerCase()) ?? null;
}

/** Whether a key press should be left alone because the person is typing or using a modifier. */
export function isTypingContext(target: { tagName?: string; isContentEditable?: boolean } | null, e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true;
  const tag = (target?.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
}
