/**
 * Which parts of the dashboard are shown, and in what order. Kept as plain data so it can be remembered between visits and
 * repaired if it is ever out of date (a section added in a later version, a saved id that no longer exists).
 */
export const DASHBOARD_SECTIONS = [
  { id: 'attention', label: 'Needs attention', hint: 'Reversed payments, quotes about to lapse, prices below cost' },
  { id: 'today', label: 'Today', hint: 'Invoices issued, cash collected, spent and due today' },
  { id: 'figures', label: 'Key figures', hint: 'Invoiced, received, outstanding and overdue' },
  { id: 'money', label: 'Profit, GST and target', hint: 'Profit for the period, GST this month and the monthly target' },
  { id: 'speed', label: 'Payment speed and spending', hint: 'How long customers take to pay, and what was spent' },
  { id: 'charts', label: 'Charts', hint: 'Aging, top clients, revenue and invoice trends, expenses' },
  { id: 'insights', label: 'Best sellers and stock not selling', hint: 'What sells best, and what has sat unsold for 90 days' },
  { id: 'mix', label: 'How customers paid and festival season', hint: 'Cash, UPI and bank split; this festival against last year' },
  { id: 'activity', label: 'Recent invoices, low stock and quotes', hint: 'The latest invoices, what to reorder, quotes waiting' },
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number]['id'];

export interface DashboardLayout {
  /** Every section, in the order shown. */
  order: DashboardSectionId[];
  /** Sections the owner has switched off. */
  hidden: DashboardSectionId[];
}

const IDS = DASHBOARD_SECTIONS.map((s) => s.id) as DashboardSectionId[];
const isSection = (v: unknown): v is DashboardSectionId => typeof v === 'string' && (IDS as string[]).includes(v);

export const defaultLayout = (): DashboardLayout => ({ order: [...IDS], hidden: [] });

/**
 * Turns whatever was saved into a usable layout. Unknown or repeated sections are dropped, and sections the saved layout
 * doesn't mention (new in this version) are added at the end, shown.
 */
export function normaliseLayout(raw: unknown): DashboardLayout {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as { order?: unknown; hidden?: unknown };
  const order: DashboardSectionId[] = [];
  for (const id of Array.isArray(saved.order) ? saved.order : []) if (isSection(id) && !order.includes(id)) order.push(id);
  for (const id of IDS) if (!order.includes(id)) order.push(id);
  const hidden = [...new Set(Array.isArray(saved.hidden) ? saved.hidden.filter(isSection) : [])];
  return { order, hidden };
}

/** Moves a section one place up or down, staying put at the ends. */
export function moveSection(layout: DashboardLayout, id: DashboardSectionId, by: -1 | 1): DashboardLayout {
  const from = layout.order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { ...layout, order };
}

/** Shows a hidden section or hides a shown one. */
export function toggleSection(layout: DashboardLayout, id: DashboardSectionId): DashboardLayout {
  return { ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id] };
}

/** The sections to draw, in order, without the hidden ones. */
export const visibleSections = (layout: DashboardLayout): DashboardSectionId[] => layout.order.filter((id) => !layout.hidden.includes(id));
