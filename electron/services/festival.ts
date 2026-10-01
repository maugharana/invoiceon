import { FESTIVALS, festivalById, festivalSeason } from '../../shared/festivals';
import { addDays, todayIso } from '../../shared/gst';
import { daysInRange } from '../../shared/periods';
import type { FestivalComparison, FestivalFigures } from '../../shared/types';
import type { Db } from '../db/connection';
import { UserError } from './common';
import { salesReport } from './reports';

function figures(db: Db, range: { from: string; to: string }): FestivalFigures {
  const s = salesReport(db, range);
  return { range, invoicedPaise: s.invoicedPaise, piecesSold: s.piecesSold, invoiceCount: s.invoiceCount };
}

/**
 * This year's festival season against last year's. Once the season is under way both years are cut to the same number of days
 * (the first 12 days of this year's against the first 12 days of last year's), because a half-finished season set against a
 * whole one would always look like a bad year.
 */
export function festivalComparison(db: Db, festivalId: string, today: string = todayIso()): FestivalComparison {
  const festival = festivalById(festivalId);
  if (!festival) throw new UserError(`Choose a festival from the list (${FESTIVALS.map((f) => f.name).join(', ')}).`);
  const year = Number(today.slice(0, 4));
  const now = festivalSeason(festival, year);
  const before = festivalSeason(festival, year - 1);
  const base = { festivalId: festival.id, name: festival.name, date: now?.date ?? null, lastDate: before?.date ?? null, season: now ? { from: now.from, to: now.to } : null };

  if (!now) return { ...base, state: 'unknown', startsInDays: null, thisSeason: null, lastSeason: before ? figures(db, before) : null };

  if (today < now.from) {
    // Not begun: show how last year went, to plan against.
    return { ...base, state: 'upcoming', startsInDays: daysInRange({ from: today, to: now.from }) - 1, thisSeason: null, lastSeason: before ? figures(db, before) : null };
  }

  if (today <= now.to) {
    const elapsed = daysInRange({ from: now.from, to: today });
    const lastSame = before ? { from: before.from, to: addDays(before.from, elapsed - 1) } : null;
    return { ...base, state: 'running', startsInDays: null, thisSeason: figures(db, { from: now.from, to: today }), lastSeason: lastSame ? figures(db, lastSame) : null };
  }

  return { ...base, state: 'done', startsInDays: null, thisSeason: figures(db, now), lastSeason: before ? figures(db, before) : null };
}
