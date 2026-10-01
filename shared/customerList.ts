import type { Customer } from './types';

/** The quick filters above the Customers list. */
export type CustomerFilter = 'all' | 'owes' | 'advance' | 'b2b' | 'b2c';

export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = { all: 'Everyone', owes: 'Owe me', advance: 'Hold advance', b2b: 'Businesses (B2B)', b2c: 'Retail (B2C)' };

export function filterCustomers(rows: Customer[], filter: CustomerFilter): Customer[] {
  switch (filter) {
    case 'owes':
      return rows.filter((c) => c.outstandingPaise > 0);
    case 'advance':
      return rows.filter((c) => c.advancePaise > 0);
    case 'b2b':
      return rows.filter((c) => c.type === 'B2B');
    case 'b2c':
      return rows.filter((c) => c.type === 'B2C');
    default:
      return rows;
  }
}

/** A phone number reduced to its last ten digits, so "+91 98765-43210", "098765 43210" and "9876543210" are the same number. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

export interface DuplicateGroup {
  /** What the customers have in common. */
  reason: 'phone' | 'gstin';
  /** The shared phone (as ten digits) or GSTIN. */
  value: string;
  customers: Customer[];
}

/**
 * Customers who look like the same person or business: the same phone number, or the same GSTIN. A customer can appear in two groups
 * (same phone as one, same GSTIN as another). Names alone are never enough: two people can be called Sunita.
 */
export function findDuplicateGroups(rows: Customer[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const by = (reason: DuplicateGroup['reason'], key: (c: Customer) => string) => {
    const map = new Map<string, Customer[]>();
    for (const c of rows) {
      const k = key(c);
      if (k) map.set(k, [...(map.get(k) ?? []), c]);
    }
    for (const [value, customers] of map) if (customers.length > 1) groups.push({ reason, value, customers });
  };
  by('gstin', (c) => c.gstin.trim().toUpperCase());
  by('phone', (c) => phoneKey(c.phone));
  return groups;
}
