export const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
export const fmtShort = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
export const fmtNum = (n?: number | null) => (n === null || n === undefined ? '–' : Number.isInteger(n) ? String(n) : n.toFixed(1));
export function timeAgo(d: string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)} d ago`;
  return fmtShort(d);
}
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
/** +923001234567 → 0300 1234567 (how people in Pakistan write it) */
export const fmtPhone = (p?: string | null) => (p && /^\+92\d{10}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6)}` : p ?? '');

/** DD/MM/YYYY (how Pakistani schools write it) -> YYYY-MM-DD; null when empty, 'bad' when not a real date */
export function parseDob(v: string): string | null | 'bad' {
  const t = v.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) ?? null;
  if (m) {
    const d = new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!));
    return d.getUTCMonth() === +m[2]! - 1 ? d.toISOString().slice(0, 10) : 'bad';
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : 'bad';
}
