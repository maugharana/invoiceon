// Off-site backup: a copy of the database kept in a folder outside the app's own data folder, usually one that a cloud service
// (Google Drive, OneDrive, Dropbox) or a USB drive keeps safe. InvoiceOn itself never talks to any cloud service.

export const MIN_PASSPHRASE = 8;

export interface OffsiteFile {
  name: string;
  bytes: number;
  modifiedAt: string;
  encrypted: boolean;
}

export interface OffsiteStatus {
  /** The folder copies go to, or null when off-site copies are not set up. */
  folder: string | null;
  /** Whether the copies are encrypted with the owner's passphrase. */
  encrypted: boolean;
  /** Whether the folder can be reached right now (a USB drive may be unplugged). */
  reachable: boolean;
  /** When the last copy was made, and its file name. */
  lastAt: string | null;
  lastFile: string | null;
  /** Why the last attempt failed, or null if it worked. */
  lastError: string | null;
  /** Copies in the folder, newest first. */
  files: OffsiteFile[];
}

export interface OffsiteSetup {
  folder: string;
  encrypt: boolean;
  /** Needed when turning encryption on (or changing it). Never stored: only a key derived from it is. */
  passphrase?: string;
}
