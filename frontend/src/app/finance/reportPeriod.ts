export const reportPeriods = [
  ['today', 'Today'], ['this-week', 'This week'], ['this-month', 'This month'],
  ['last-month', 'Last month'], ['this-year', 'This year'], ['custom', 'Custom dates'],
] as const;
export type ReportPeriod = typeof reportPeriods[number][0];

// Receives the hotel's Lagos calendar date, never the browser's local midnight.
export function periodDates(period: ReportPeriod, today: string): { from: string; to: string } | null {
  const date = new Date(today + 'T00:00:00Z');
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  switch (period) {
    case 'today': return { from: today, to: today };
    case 'this-week': {
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      return { from: iso(date), to: today };
    }
    case 'this-month': return { from: today.slice(0, 7) + '-01', to: today };
    case 'last-month': {
      date.setUTCDate(0);
      return { from: iso(date).slice(0, 7) + '-01', to: iso(date) };
    }
    case 'this-year': return { from: today.slice(0, 4) + '-01-01', to: today };
    default: return null;
  }
}
export function matchingPeriod(from: string, to: string, today: string): ReportPeriod {
  // Prefer the default month when several shortcuts coincide on the first day.
  for (const period of ['this-month', 'today', 'this-week', 'last-month', 'this-year'] as const) {
    const range = periodDates(period, today)!;
    if (range.from === from && range.to === to) return period;
  }
  return 'custom';
}
