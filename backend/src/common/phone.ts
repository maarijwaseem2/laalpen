/**
 * Pakistani mobile numbers in one format (+923XXXXXXXXX), so "0300-1234567", "92 300 1234567"
 * and "+923001234567" are the same parent. Returns null for anything that is not a mobile number.
 */
export function normalizePkPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/[^0-9]/g, '');
  let local: string | null = null;
  if (d.length === 12 && d.startsWith('92')) local = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) local = d.slice(1);
  else if (d.length === 10 && d.startsWith('3')) local = d;
  else if (d.length === 14 && d.startsWith('0092')) local = d.slice(4);
  if (!local || !/^3\d{9}$/.test(local) || /^3(\d)\1{8}$/.test(local) || local === '3000000000') return null;
  return `+92${local}`;
}

/** "+923001234567" -> "0300 1234567" for display. */
export const displayPkPhone = (e164?: string | null) => (e164 ? `0${e164.slice(3, 6)} ${e164.slice(6)}` : '');

/** "+923001234567" -> "0300 ***4567" */
export const maskPhone = (e164: string) => `0${e164.slice(3, 6)} ***${e164.slice(-4)}`;
