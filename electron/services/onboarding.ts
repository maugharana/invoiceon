import type { OnboardingStatus } from '../../shared/onboarding';
import { all, get, run, type Db } from '../db/connection';
import { nowIso } from './common';
import { getSettings } from './settings';

const setting = (db: Db, key: string): string | undefined => all<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', key)[0]?.value;
const count = (db: Db, sql: string): number => get<{ n: number }>(db, sql)?.n ?? 0;

export function onboardingStatus(db: Db): OnboardingStatus {
  const s = getSettings(db);
  const steps = [
    { id: 'profile' as const, done: !!(s.businessName.trim() && s.addressLine.trim() && s.city.trim() && s.state.trim() && s.phone.trim()) },
    { id: 'sarees' as const, done: count(db, 'SELECT COUNT(*) AS n FROM designs WHERE deleted_at IS NULL') > 0 },
    { id: 'customers' as const, done: count(db, 'SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL') > 0 },
    { id: 'invoice' as const, done: count(db, 'SELECT COUNT(*) AS n FROM invoices') > 0 },
    { id: 'backup' as const, done: !!setting(db, 'offsite_folder') },
  ];
  return { steps, dismissed: setting(db, 'onboarding_dismissed') === '1' };
}

export function dismissOnboarding(db: Db): OnboardingStatus {
  run(db, "INSERT INTO settings (key, value, updated_at) VALUES ('onboarding_dismissed', '1', ?) ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at", nowIso());
  return onboardingStatus(db);
}
