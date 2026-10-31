// Browser navigation preferences only. No amounts, notes or credentials belong here.
export type ReportPosition = { from: string; to: string; department: string; mode: 'summary' | 'entries'; detailId: string };
export function parseReportPosition(raw: string | null): Partial<ReportPosition> {
  try {
    const value: unknown = JSON.parse(raw || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const data = value as Record<string, unknown>;
    const result: Partial<ReportPosition> = {};
    for (const key of ['from', 'to'] as const) {
      const date = data[key];
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date) result[key] = date;
    }
    if (typeof data.department === 'string' && /^(|[a-z-]{1,40})$/.test(data.department)) result.department = data.department;
    if (data.mode === 'summary' || data.mode === 'entries') result.mode = data.mode;
    if (typeof data.detailId === 'string' && /^(|[a-f\d]{24})$/i.test(data.detailId)) result.detailId = data.detailId;
    return result;
  } catch { return {}; }
}
export function workspaceSection(hash: string, saved: string | null, isGM: boolean) {
  const value = hash.replace(/^#/, '').split('?')[0] || saved || 'overview';
  return ['overview', 'guests', 'reports'].includes(value) || (value === 'staff' && isGM) ? value : 'overview';
}
