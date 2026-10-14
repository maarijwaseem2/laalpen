import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { LETTERS, MARKER_CENTRE, MARKER_SIZE, PAGE_H, PAGE_W, bubbleRadius, omrLayout, toPage } from './omr-layout.js';

const RED = '#C8102E';
const INK = '#1B2A4A';

export interface SheetStudent { id: string; name: string; rollNo: string }
export interface SheetTest { id: string; title: string; subject: string; className: string; sectionName: string; school: string }
export interface QrInfo { testId: string; studentId: string; page: number; kind: 'copy' | 'omr'; questions?: number; options?: number }

function toBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/**
 * Printable sheets with a signed QR code, so a teacher can photograph a whole pile of copies in any order:
 * - answer booklets: every page says whose copy it is and which page;
 * - QR stickers: for schools that use their own answer sheets (stick one on each page);
 * - OMR bubble sheets: multiple-choice tests are read and marked without the AI (free, instant).
 */
@Injectable()
export class SheetsService {
  private sig(body: string) {
    return createHmac('sha256', env.fileSigningSecret).update(`qr:${body}`).digest('base64url').slice(0, 10);
  }

  qrText(testId: string, studentId: string, page: number, kind: 'c' | `o${number}x${number}`) {
    const body = `LP1.${testId}.${studentId}.${page}.${kind}`;
    return `${body}.${this.sig(body)}`;
  }

  /** Checks the signature: a QR printed for another school / test, or a forged one, is ignored. */
  verify(text: string | null | undefined): QrInfo | null {
    const m = text?.trim().match(/^(LP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.(\d{1,2})\.(c|o(\d{1,2})x(\d)))\.([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    const want = Buffer.from(this.sig(m[1]));
    const got = Buffer.from(m[8]);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    return { testId: m[2], studentId: m[3], page: Number(m[4]), kind: m[5] === 'c' ? 'copy' : 'omr', ...(m[6] ? { questions: Number(m[6]), options: Number(m[7]) } : {}) };
  }

  private qr(text: string) {
    return QRCode.toBuffer(text, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } });
  }

  /** One answer booklet per student: `pages` ruled pages, each with name, roll, page number and QR. */
  async bookletPdf(test: SheetTest, students: SheetStudent[], pages: number) {
    const doc = new PDFDocument({ size: 'A4', margin: 36, autoFirstPage: false, info: { Title: `${test.title} — answer booklets`, Author: 'LaalPen' } });
    for (const s of students) {
      for (let p = 1; p <= pages; p++) {
        doc.addPage();
        doc.image(await this.qr(this.qrText(test.id, s.id, p, 'c')), PAGE_W - 36 - 78, 30, { width: 78 });
        doc.fillColor(RED).font('Helvetica-Bold').fontSize(14).text('LaalPen', 36, 34);
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(`${s.name}  ·  Roll ${s.rollNo}`, 36, 54, { width: PAGE_W - 170 });
        doc.font('Helvetica').fontSize(9).fillColor('#555555').text(`${test.className} ${test.sectionName} · ${test.subject} · ${test.title}`, 36, 72, { width: PAGE_W - 170 });
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(`Page ${p} of ${pages}`, 36, 88);
        doc.font('Helvetica').fontSize(7).fillColor('#888888').text('Do not write on the QR code. Write inside the margins.', 36, 102);
        doc.strokeColor('#C8D3E6').lineWidth(0.6);
        for (let y = 128; y < PAGE_H - 40; y += 24) doc.moveTo(36, y).lineTo(PAGE_W - 36, y).stroke();
        doc.strokeColor('#E8A0A8').lineWidth(0.8).moveTo(70, 118).lineTo(70, PAGE_H - 40).stroke();
      }
    }
    return toBuffer(doc);
  }

  /** QR stickers (3 × 8 per A4 label sheet): one per page of every student's copy. */
  async stickersPdf(test: SheetTest, students: SheetStudent[], pages: number) {
    const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `${test.title} — QR stickers`, Author: 'LaalPen' } });
    const cols = 3;
    const rows = 8;
    const W = (PAGE_W - 30) / cols;
    const H = (PAGE_H - 40) / rows;
    let i = 0;
    for (const s of students) {
      for (let p = 1; p <= pages; p++, i++) {
        if (i && i % (cols * rows) === 0) doc.addPage();
        const x = 15 + (i % cols) * W;
        const y = 20 + (Math.floor(i / cols) % rows) * H;
        doc.image(await this.qr(this.qrText(test.id, s.id, p, 'c')), x + 6, y + 8, { width: H - 16 });
        doc.fillColor(INK).font('Helvetica-Bold').fontSize(8.5).text(s.name, x + H, y + 14, { width: W - H - 6, height: 22 });
        doc.font('Helvetica').fontSize(7.5).text(`Roll ${s.rollNo} · Page ${p}`, x + H, y + 40, { width: W - H - 6 });
        doc.fillColor('#777777').fontSize(6.5).text(test.title, x + H, y + 54, { width: W - H - 6, height: 18 });
      }
    }
    return toBuffer(doc);
  }

  /** OMR bubble sheets for multiple-choice tests (one per student). */
  async omrPdf(test: SheetTest, students: SheetStudent[], n: number, k: number) {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false, info: { Title: `${test.title} — OMR sheets`, Author: 'LaalPen' } });
    const layout = omrLayout(n, k);
    const r = bubbleRadius(n, k);
    const h = MARKER_SIZE / 2;
    for (const s of students) {
      doc.addPage({ size: 'A4', margin: 0 });
      doc.fillColor('#000000');
      for (const [cx, cy] of [[MARKER_CENTRE, MARKER_CENTRE], [PAGE_W - MARKER_CENTRE, MARKER_CENTRE], [MARKER_CENTRE, PAGE_H - MARKER_CENTRE], [PAGE_W - MARKER_CENTRE, PAGE_H - MARKER_CENTRE]]) {
        doc.rect(cx - h, cy - h, MARKER_SIZE, MARKER_SIZE).fill('#000000');
      }
      doc.image(await this.qr(this.qrText(test.id, s.id, 1, `o${n}x${k}`)), PAGE_W - 70 - 120, 66, { width: 120 });
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(16).text('LaalPen', 70, 64);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(s.name, 70, 88, { width: 300 });
      doc.font('Helvetica').fontSize(10).text(`Roll ${s.rollNo} · ${test.className} ${test.sectionName}`, 70, 106, { width: 300 });
      doc.fontSize(10).text(`${test.subject} — ${test.title}`, 70, 122, { width: 300 });
      doc.fontSize(8.5).fillColor('#555555').text(`${test.school}`, 70, 138, { width: 300 });
      doc.fontSize(9).fillColor(INK).text('Fill ONE circle completely for each question with a dark pen or pencil. Do not tick or cross.', 70, 168, { width: 330 });
      doc.fontSize(8).fillColor('#777777').text('Keep the four black squares and the QR code clean. Photograph the whole page.', 70, 196, { width: 330 });
      // column headers (letters) and question numbers sit outside the bubbles, so empty bubbles read as empty
      const firstRowOfCol = new Map<number, number>();
      layout.forEach((row, qi) => {
        const key = Math.round(row[0].labelX * 1000);
        if (!firstRowOfCol.has(key)) firstRowOfCol.set(key, qi);
      });
      for (const qi of firstRowOfCol.values()) {
        layout[qi].forEach((b, j) => {
          const p = toPage(b.x, b.y);
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#555555').text(LETTERS[j], p.x - 10, p.y - r - 14, { width: 20, align: 'center' });
        });
      }
      layout.forEach((row, qi) => {
        const lp = toPage(row[0].labelX, row[0].y);
        doc.font('Helvetica-Bold').fontSize(Math.min(10, r * 1.2)).fillColor(INK).text(`${qi + 1}`, lp.x, lp.y - r * 0.6, { width: 0.06 * 515, align: 'right' });
        for (const b of row) {
          const p = toPage(b.x, b.y);
          doc.lineWidth(0.9).strokeColor('#333333').circle(p.x, p.y, r).stroke();
        }
      });
    }
    return toBuffer(doc);
  }
}
