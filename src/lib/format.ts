export const plural = (n: number, singular: string, pluralForm = `${singular}s`): string => `${n} ${n === 1 ? singular : pluralForm}`;

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return `${date}, ${time}`;
}

export const todayLong = (): string => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

/** Quantity as typed in a form → number, or NaN when blank/invalid. Accepts decimals so raw-material metres work. */
export const toNumber = (text: string): number => (text.trim() === '' ? NaN : Number(text));
