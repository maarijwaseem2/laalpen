import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { StorageService } from '../storage/storage.service.js';
import { env } from '../config/env.js';

export interface CardInfo {
  name: string;
  className: string;
  sectionName: string;
  rollNo: string;
  code: string;
}

const RED = '#C8102E';
const INK = '#1B2A4A';

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
 * Printable A4 sheets of claim cards (8 per page): name, class, roll, a one-time code and a QR code
 * that opens the LaalPen app straight on the claim screen. Teachers cut them and hand them out,
 * or send a photo of one card to the family on WhatsApp.
 */
@Injectable()
export class CardsService {
  constructor(private readonly storage: StorageService) {}

  async claimCardsPdf(schoolName: string, cards: CardInfo[], kind: 'STUDENT' | 'PARENT'): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 24, info: { Title: `${schoolName} — LaalPen ${kind === 'PARENT' ? 'parent' : 'student'} cards`, Author: 'LaalPen' } });
    const W = (doc.page.width - 48) / 2;
    const H = (doc.page.height - 48) / 4;
    for (let i = 0; i < cards.length; i++) {
      if (i && i % 8 === 0) doc.addPage();
      const c = cards[i];
      const x = 24 + (i % 2) * W;
      const y = 24 + (Math.floor(i / 2) % 4) * H;
      doc.save().dash(4, { space: 4 }).strokeColor('#BBBBBB').rect(x + 4, y + 4, W - 8, H - 8).stroke().restore();
      doc.fillColor(RED).font('Helvetica-Bold').fontSize(16).text('LaalPen', x + 16, y + 16);
      doc.fillColor('#666666').font('Helvetica').fontSize(8).text(schoolName, x + 16, y + 36, { width: W - 140 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text(c.name, x + 16, y + 56, { width: W - 140 });
      doc.font('Helvetica').fontSize(10).text(`${c.className} ${c.sectionName} · Roll ${c.rollNo}`, x + 16, y + 76, { width: W - 140 });
      doc.fillColor('#666666').fontSize(8).text(kind === 'PARENT' ? 'Parent code' : 'Student code', x + 16, y + 100);
      doc.fillColor(RED).font('Courier-Bold').fontSize(20).text(c.code, x + 16, y + 110);
      const steps =
        kind === 'PARENT'
          ? 'App kholen » "Parent" » apna phone number » Settings mein "Add child" » ye code likhen.'
          : 'LaalPen app kholen » "I am a student" » "I have a code" » ye code likhen. Code sirf aik dafa chalega.';
      doc.fillColor(INK).font('Helvetica').fontSize(7.5).text(steps, x + 16, y + 138, { width: W - 140 });
      const deep = `${env.appScheme}://${kind === 'PARENT' ? 'parent' : 'claim'}?code=${c.code.replace('-', '')}`;
      const qr = await QRCode.toBuffer(deep, { margin: 1, width: 220, color: { dark: INK, light: '#FFFFFF' } });
      doc.image(qr, x + W - 122, y + 24, { width: 104 });
      doc.fillColor('#888888').fontSize(6.5).text('Scan to open the app', x + W - 122, y + 132, { width: 104, align: 'center' });
    }
    return toBuffer(doc);
  }

  /** Saves a generated file and returns a short-lived download link. */
  async publish(key: string, data: Buffer, contentType: string) {
    await this.storage.save(key, data, contentType);
    return { url: this.storage.signedUrl(key, 60), key };
  }
}
