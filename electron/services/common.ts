import { randomUUID } from 'node:crypto';

/** An expected, user-fixable failure (duplicate code, not enough stock…). The message is shown as-is in the UI. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export const newId = (): string => randomUUID();
let lastStamp = 0;
/**
 * The current time, but never the same millisecond twice. Things done in quick succession (an invoice and the payment
 * taken with it) must sort in the order they happened — the ledger relies on it — and two writes in one millisecond
 * would otherwise tie.
 */
export const nowIso = (): string => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
};

export function requireText(value: unknown, label: string, maxLength = 120): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new UserError(`${label} is required.`);
  if (text.length > maxLength) throw new UserError(`${label} is too long (max ${maxLength} characters).`);
  return text;
}

export function optionalText(value: unknown, label: string, maxLength = 500): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > maxLength) throw new UserError(`${label} is too long (max ${maxLength} characters).`);
  return text;
}

export function requireInt(value: unknown, label: string, opts: { min?: number; max?: number } = {}): number {
  const { min = 0, max = 1_000_000_000 } = opts;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new UserError(`${label} must be a whole number.`);
  if (value < min) throw new UserError(`${label} can't be less than ${min}.`);
  if (value > max) throw new UserError(`${label} is too large.`);
  return value;
}

/** Turns SQLite constraint failures into messages a shop owner can act on. */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}
