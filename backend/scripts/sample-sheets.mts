// Writes sample OMR sheets and an answer booklet to the folder given (for printing tests):
//   npx tsx scripts/sample-sheets.mts ./samples
import { writeFileSync } from 'node:fs';
import { SheetsService } from '../src/scan/sheets.service.js';
const s = new SheetsService();
const test = { id: 'testabc123', title: 'MCQ Quiz 1', subject: 'Physics', className: 'Class 9', sectionName: 'A', school: 'Al-Noor Grammar School' };
for (const [n, k] of [[20, 4], [40, 4], [60, 5]]) {
  const pdf = await s.omrPdf(test, [{ id: 'stud1', name: 'Ali Raza', rollNo: '03' }], n, k);
  writeFileSync(`${process.argv[2]}/omr-${n}x${k}.pdf`, pdf);
}
const b = await s.bookletPdf(test, [{ id: 'stud1', name: 'Ali Raza', rollNo: '03' }], 2);
writeFileSync(`${process.argv[2]}/booklet.pdf`, b);
console.log(s.verify(s.qrText('testabc123', 'stud1', 1, 'o20x4')), s.verify(s.qrText('t', 's', 1, 'c') + 'x'));
