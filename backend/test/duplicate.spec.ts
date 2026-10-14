import { describe, expect, it } from 'vitest';
import { hammingHex, looksDuplicate } from '../src/checking/checking.service.js';

/** BUG-01: printed QR booklets look alike; only a real re-upload is a duplicate. */
describe('duplicate photo check', () => {
  const h = 'f0f0f0f0f0f0f0f0';
  const near = 'f0f0f0f0f0f0f0f3'; // 2 bits away: re-compressed / resized photo
  it('the same photo (re-sized or re-compressed) is a duplicate', () => {
    expect(hammingHex(h, near)).toBe(2);
    expect(looksDuplicate({ phash: h }, { phash: near })).toBe(true);
    expect(looksDuplicate({ phash: h, qrCode: 'LP1-x-p1' }, { phash: near, qrCode: 'LP1-x-p1' })).toBe(true);
  });
  it('different students\' booklet pages with the same template are not duplicates', () => {
    expect(looksDuplicate({ phash: h, qrCode: 'LP1-roll01-p1' }, { phash: h, qrCode: 'LP1-roll06-p1' })).toBe(false);
  });
  it('a QR page copied into a copy without a QR still counts, and different photos never do', () => {
    expect(looksDuplicate({ phash: h, qrCode: null }, { phash: h, qrCode: 'LP1-roll01-p1' })).toBe(true);
    expect(looksDuplicate({ phash: h }, { phash: '0f0f0f0f0f0f0f0f' })).toBe(false);
    expect(looksDuplicate({ phash: null }, { phash: h })).toBe(false);
  });
});
