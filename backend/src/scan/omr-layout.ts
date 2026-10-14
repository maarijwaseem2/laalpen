/**
 * OMR sheet geometry — the same formula as ai-service/app/scan.py (keep both in sync).
 * Positions are in "marker space": the centres of the four corner squares are (0,0), (1,0), (0,1), (1,1).
 */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const MARKER_CENTRE = 40; // points from the page edge
export const MARKER_SIZE = 24;
export const MARKER_W = PAGE_W - 2 * MARKER_CENTRE; // 515.28
export const MARKER_H = PAGE_H - 2 * MARKER_CENTRE; // 761.89
export const GRID = { top: 0.3, bottom: 0.97, left: 0.06, right: 0.98 };
export const LETTERS = 'ABCDEFGH';
export const MAX_OMR_QUESTIONS = 75;

function dims(n: number, k: number) {
  const cols = n <= 25 ? 1 : n <= 50 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const cw = (GRID.right - GRID.left) / cols;
  const rh = Math.min((GRID.bottom - GRID.top) / rows, 0.04);
  const bs = Math.min(0.06, (cw - 0.1) / k);
  return { cols, rows, cw, rh, bs };
}

/** layout[q][option] = { x, y } in marker space */
export function omrLayout(n: number, k: number) {
  const { rows, cw, rh, bs } = dims(n, k);
  return Array.from({ length: n }, (_, i) => {
    const col = Math.floor(i / rows);
    const row = i % rows;
    const x0 = GRID.left + col * cw;
    const y = GRID.top + rh * (row + 0.5);
    return Array.from({ length: k }, (_, j) => ({ x: x0 + 0.09 + j * bs, y, labelX: x0 }));
  });
}

export function bubbleRadius(n: number, k: number) {
  const { rh, bs } = dims(n, k);
  return Math.min(rh * MARKER_H, bs * MARKER_W) * 0.32;
}

/** marker space → PDF points */
export const toPage = (x: number, y: number) => ({ x: MARKER_CENTRE + x * MARKER_W, y: MARKER_CENTRE + y * MARKER_H });
