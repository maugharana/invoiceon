// Several businesses in one installation, each with its own database. See electron/businesses.ts.

export interface Business {
  id: string;
  name: string;
  /** The one that is open. */
  active: boolean;
  /** Where its files are. */
  dir: string;
}

export interface BusinessList {
  activeId: string;
  businesses: Business[];
}
