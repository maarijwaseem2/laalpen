import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { normalizePkPhone } from '../common/phone.js';
import { encryptField } from '../common/crypto.js';
import type { AuthUser } from '../common/decorators.js';
import { RosterService, normName } from './roster.service.js';

type Field = 'admissionNo' | 'name' | 'fatherName' | 'className' | 'section' | 'rollNo' | 'dob' | 'gender' | 'guardianName' | 'guardianPhone' | 'guardianEmail' | 'bForm';

/** Column names schools actually use (English, Roman Urdu and Urdu). */
const ALIASES: Record<Field, string[]> = {
  admissionNo: ['admissionno', 'admission', 'admno', 'grno', 'gr', 'grnumber', 'regno', 'registrationno', 'registration', 'studentid', 'داخلہنمبر', 'جیآرنمبر', 'داخلہ'],
  name: ['name', 'studentname', 'student', 'fullname', 'نام', 'طالبعلم', 'طالبعلمکانام'],
  fatherName: ['fathername', 'father', 'fname', 'fathersname', 'walid', 'والدکانام', 'ولدیت', 'والد'],
  className: ['class', 'grade', 'classname', 'standard', 'کلاس', 'جماعت'],
  section: ['section', 'sec', 'سیکشن', 'شعبہ'],
  rollNo: ['rollno', 'roll', 'rollnumber', 'rno', 'رولنمبر', 'رول'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'birthday', 'تاریخپیدائش'],
  gender: ['gender', 'sex', 'جنس'],
  guardianName: ['guardianname', 'guardian', 'parentname', 'parent', 'سرپرست', 'سرپرستکانام'],
  guardianPhone: ['phone', 'mobile', 'guardianphone', 'parentphone', 'contact', 'contactno', 'mobileno', 'phoneno', 'cell', 'whatsapp', 'fathermobile', 'fatherphone', 'فون', 'موبائل', 'رابطہ', 'رابطہنمبر'],
  guardianEmail: ['email', 'guardianemail', 'parentemail', 'ای میل', 'ایمیل'],
  bForm: ['bform', 'bformno', 'formb', 'cnic', 'bformnumber', 'بفارم', 'بیفارم'],
};

const headerKey = (h: string) => h.toLowerCase().replace(/[\s_\-.()#:/'"]+/g, '');

export interface ImportRow {
  line: number;
  values: Partial<Record<Field, string>>;
  action?: 'new' | 'update' | 'unchanged' | 'error';
  studentId?: string;
  errors: string[];
  warnings: string[];
  changes?: string[];
  classId?: string | null;
  sectionId?: string | null;
}

/**
 * Excel / CSV roster import with a dry run. Re-importing the same register UPDATES students
 * (keyed on admission/GR number) instead of duplicating them, and never deletes anyone.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roster: RosterService,
    private readonly audit: AuditService,
  ) {}

  // ---------- reading files ----------

  private cellText(v: ExcelJS.CellValue): string {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
    if (typeof v === 'object') {
      if ('richText' in v) return v.richText.map((r) => r.text).join('');
      if ('result' in v) return this.cellText(v.result as ExcelJS.CellValue);
      if ('text' in v) return String(v.text);
      return '';
    }
    return String(v).trim();
  }

  parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    const delim = (text.split('\n')[0].match(/;/g)?.length ?? 0) > (text.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') {
          cell += '"';
          i++;
        } else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === delim || c === '\t') {
        row.push(cell.trim());
        cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim());
        if (row.some((x) => x)) rows.push(row);
        row = [];
        cell = '';
      } else cell += c;
    }
    row.push(cell.trim());
    if (row.some((x) => x)) rows.push(row);
    return rows;
  }

  async readTable(file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<string[][]> {
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt') || file.mimetype.includes('csv')) {
      return this.parseCsv(file.buffer.toString('utf8').replace(/^﻿/, ''));
    }
    if (!name.endsWith('.xlsx')) throw new BadRequestException('Upload an Excel (.xlsx) or CSV file. Old .xls files: open in Excel and "Save as" .xlsx');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as never);
    } catch {
      throw new BadRequestException('Could not read this Excel file');
    }
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) throw new BadRequestException('The file is empty');
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (r) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.actualColumnCount; c++) cells.push(this.cellText(r.getCell(c).value));
      if (cells.some(Boolean)) rows.push(cells);
    });
    return rows;
  }

  mapHeaders(headers: string[]) {
    const map: Partial<Record<Field, number>> = {};
    headers.forEach((h, i) => {
      const k = headerKey(h);
      for (const [field, names] of Object.entries(ALIASES) as [Field, string[]][]) {
        if (map[field] === undefined && names.some((n) => headerKey(n) === k)) map[field] = i;
      }
    });
    // "Email" with a separate parent email column: keep both readable later
    return map;
  }

  parseDate(v: string): Date | null | 'bad' {
    if (!v) return null;
    let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return this.mkDate(+m[1], +m[2], +m[3]);
    m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); // Pakistani order: DD/MM/YYYY
    if (m) return this.mkDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
    if (/^\d{5}$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000); // Excel serial
    return 'bad';
  }

  private mkDate(y: number, mo: number, d: number) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1 || y < 1990 || y > new Date().getFullYear()) return 'bad' as const;
    return dt;
  }

  // ---------- dry run ----------

  async dryRun(actor: AuthUser, file: { buffer: Buffer; originalname: string; mimetype: string }, opts: { createMissing?: boolean } = {}) {
    const schoolId = actor.schoolId!;
    const table = await this.readTable(file);
    if (table.length < 2) throw new BadRequestException('The file needs a header row and at least one student');
    if (table.length > 5001) throw new BadRequestException('Up to 5,000 students per file');
    const headerIdx = table.findIndex((r) => Object.keys(this.mapHeaders(r)).length >= 2);
    if (headerIdx < 0) throw new BadRequestException('Could not find the header row. Use the template: Name, Class, Section, Roll No …');
    const map = this.mapHeaders(table[headerIdx]);
    const missing = (['name', 'className', 'rollNo'] as Field[]).filter((f) => map[f] === undefined);
    if (missing.length) throw new BadRequestException(`Missing column${missing.length > 1 ? 's' : ''}: ${missing.map((m) => ({ name: 'Name', className: 'Class', rollNo: 'Roll No' })[m as 'name']).join(', ')}`);

    const classes = await this.prisma.schoolClass.findMany({ where: { schoolId }, include: { sections: true } });
    const existing = await this.prisma.studentProfile.findMany({ where: { schoolId }, select: { id: true, admissionNo: true, name: true, rollNo: true, sectionId: true, status: true, fatherName: true, dob: true, guardianPhone: true, guardianName: true, gender: true, guardianEmail: true } });
    const byAdm = new Map(existing.filter((e) => e.admissionNo).map((e) => [e.admissionNo!.toLowerCase(), e]));
    const seenRoll = new Map<string, number>();
    const seenAdm = new Map<string, number>();
    const toCreate = new Set<string>();

    const findClass = (raw: string) => {
      const n = normName(raw).replace(/^(class|grade)\s*/, '');
      return classes.find((c) => normName(c.name) === normName(raw) || normName(c.name).replace(/^(class|grade)\s*/, '') === n || (/^\d+$/.test(n) && c.grade === Number(n) && !/\D/.test(normName(c.name).replace(/^(class|grade)\s*/, ''))));
    };

    const rows: ImportRow[] = [];
    for (let i = headerIdx + 1; i < table.length; i++) {
      const r = table[i];
      const values: Partial<Record<Field, string>> = {};
      for (const [f, idx] of Object.entries(map) as [Field, number][]) values[f] = (r[idx] ?? '').trim();
      const row: ImportRow = { line: i + 1, values, errors: [], warnings: [] };
      if (!values.name || values.name.length < 2) row.errors.push('Name is missing');
      if (!values.rollNo) row.errors.push('Roll number is missing');
      if (!values.className) row.errors.push('Class is missing');
      values.section = values.section || 'A';
      const cls = values.className ? findClass(values.className) : undefined;
      const sec = cls?.sections.find((s) => normName(s.name) === normName(values.section!));
      if (values.className && !cls) {
        if (opts.createMissing) {
          toCreate.add(`${values.className} ${values.section}`);
          row.warnings.push(`Class ${values.className} will be created`);
        } else row.errors.push(`Class "${values.className}" does not exist (tick "create missing classes")`);
      } else if (cls && !sec) {
        if (opts.createMissing) {
          toCreate.add(`${cls.name} ${values.section}`);
          row.warnings.push(`Section ${values.section} will be created`);
        } else row.errors.push(`Section ${values.section} does not exist in ${cls.name}`);
      }
      row.classId = cls?.id ?? null;
      row.sectionId = sec?.id ?? null;
      if (values.dob) {
        const d = this.parseDate(values.dob);
        if (d === 'bad') row.errors.push(`Date of birth "${values.dob}" — write it as DD/MM/YYYY`);
        else if (d) values.dob = d.toISOString().slice(0, 10);
      }
      if (values.guardianPhone) {
        const p = normalizePkPhone(values.guardianPhone);
        if (!p) row.warnings.push(`Phone "${values.guardianPhone}" is not a Pakistani mobile number; it will be skipped`);
        values.guardianPhone = p ?? '';
      }
      if (values.bForm) {
        const d = values.bForm.replace(/\D/g, '');
        if (d.length !== 13) row.errors.push('B-Form must have 13 digits');
        else values.bForm = d;
      }
      if (values.guardianEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.guardianEmail)) {
        row.warnings.push(`Email "${values.guardianEmail}" looks wrong; it will be skipped`);
        values.guardianEmail = '';
      }
      // duplicates inside the file
      const rollKey = `${normName(values.className ?? '')}|${normName(values.section)}|${values.rollNo}`;
      if (values.rollNo && seenRoll.has(rollKey)) row.errors.push(`Roll ${values.rollNo} is repeated (also on line ${seenRoll.get(rollKey)})`);
      else seenRoll.set(rollKey, row.line);
      if (values.admissionNo) {
        const a = values.admissionNo.toLowerCase();
        if (seenAdm.has(a)) row.errors.push(`Admission no. ${values.admissionNo} is repeated (also on line ${seenAdm.get(a)})`);
        else seenAdm.set(a, row.line);
      }
      // new, update or unchanged?
      let match = values.admissionNo ? byAdm.get(values.admissionNo.toLowerCase()) : undefined;
      if (!match && sec && values.rollNo) {
        match = existing.find((e) => e.sectionId === sec.id && e.rollNo === values.rollNo && e.status === 'ACTIVE' && normName(e.name) === normName(values.name ?? '') && !e.admissionNo);
      }
      if (!row.errors.length) {
        if (match) {
          row.studentId = match.id;
          const changes: string[] = [];
          if (normName(match.name) !== normName(values.name!)) changes.push('name');
          if (sec && match.sectionId !== sec.id) changes.push('class/section');
          if (match.rollNo !== values.rollNo) changes.push('roll no');
          if (values.fatherName && match.fatherName !== values.fatherName) changes.push('father name');
          if (values.dob && match.dob?.toISOString().slice(0, 10) !== values.dob) changes.push('date of birth');
          if (values.guardianPhone && match.guardianPhone !== values.guardianPhone) changes.push('phone');
          if (values.guardianName && match.guardianName !== values.guardianName) changes.push('guardian');
          if (values.guardianEmail && match.guardianEmail !== values.guardianEmail.toLowerCase()) changes.push('email');
          if (match.status !== 'ACTIVE') changes.push('back in school');
          row.action = changes.length ? 'update' : 'unchanged';
          row.changes = changes;
        } else row.action = 'new';
        // a roll number used by a different active student in that section
        if (sec && values.rollNo) {
          const clash = existing.find((e) => e.sectionId === sec.id && e.rollNo === values.rollNo && e.status === 'ACTIVE' && e.id !== row.studentId);
          if (clash) row.errors.push(`Roll ${values.rollNo} in ${cls!.name} ${sec.name} already belongs to ${clash.name}`);
        }
      }
      if (row.errors.length) row.action = 'error';
      rows.push(row);
    }

    const count = (a: string) => rows.filter((r) => r.action === a).length;
    const summary = { total: rows.length, new: count('new'), updated: count('update'), unchanged: count('unchanged'), errors: count('error'), warnings: rows.filter((r) => r.warnings.length).length, createClasses: [...toCreate], columns: Object.keys(map) };
    const job = await this.prisma.importJob.create({
      data: { schoolId, createdById: actor.id, fileName: file.originalname.slice(0, 120), status: 'DRY_RUN', summary: summary as object, rows: rows as object, errors: rows.filter((r) => r.errors.length).map((r) => ({ line: r.line, errors: r.errors })) as object },
    });
    return { id: job.id, summary, preview: rows.slice(0, 50), problems: rows.filter((r) => r.errors.length || r.warnings.length).slice(0, 200) };
  }

  // ---------- commit ----------

  async commit(actor: AuthUser, jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.schoolId !== actor.schoolId) throw new NotFoundException('Import not found');
    if (job.status !== 'DRY_RUN') throw new BadRequestException('This import was already done');
    const claimed = await this.prisma.importJob.updateMany({ where: { id: jobId, status: 'DRY_RUN' }, data: { status: 'COMMITTING' } });
    if (!claimed.count) throw new BadRequestException('This import is already running');
    const rows = (job.rows as unknown as ImportRow[]).filter((r) => r.action === 'new' || r.action === 'update');
    const schoolId = job.schoolId;
    const result = { created: 0, updated: 0, failed: [] as { line: number; error: string }[], classesCreated: 0 };
    try {
      const session = await this.roster.currentSession(schoolId);
      const sectionCache = new Map<string, string>();
      const sectionFor = async (className: string, sectionName: string, sectionId?: string | null) => {
        if (sectionId) return sectionId;
        const key = `${normName(className)}|${normName(sectionName)}`;
        if (sectionCache.has(key)) return sectionCache.get(key)!;
        const grade = Number((className.match(/\d+/) ?? ['0'])[0]);
        const name = /^\d+$/.test(className.trim()) ? `Class ${className.trim()}` : className.trim();
        const cls = await this.prisma.schoolClass.upsert({ where: { schoolId_name: { schoolId, name } }, update: {}, create: { schoolId, name, grade: Math.min(16, grade) } });
        const sec = await this.prisma.section.upsert({ where: { classId_name: { classId: cls.id, name: sectionName } }, update: {}, create: { classId: cls.id, name: sectionName } });
        result.classesCreated++;
        sectionCache.set(key, sec.id);
        return sec.id;
      };
      for (const r of rows) {
        const v = r.values;
        try {
          const sectionId = await sectionFor(v.className!, v.section!, r.sectionId);
          await this.prisma.$transaction(async (tx) => {
            const data = {
              name: v.name!,
              rollNo: v.rollNo!,
              sectionId,
              admissionNo: v.admissionNo || null,
              fatherName: v.fatherName || null,
              dob: v.dob ? new Date(v.dob) : null,
              gender: v.gender || null,
              guardianName: v.guardianName || null,
              guardianPhone: v.guardianPhone || null,
              guardianEmail: v.guardianEmail?.toLowerCase() || null,
              ...(v.bForm ? { bFormEnc: encryptField(v.bForm, 'bform'), bFormLast4: v.bForm.slice(-4) } : {}),
            };
            let id = r.studentId;
            if (id) {
              await tx.studentProfile.update({ where: { id }, data: { ...data, status: 'ACTIVE' } });
              result.updated++;
            } else {
              const p = await tx.studentProfile.create({ data: { ...data, schoolId, createdById: actor.id } });
              id = p.id;
              result.created++;
            }
            await tx.enrollment.upsert({
              where: { studentId_sessionId: { studentId: id, sessionId: session.id } },
              update: { sectionId, rollNo: v.rollNo!, state: 'ACTIVE', endedAt: null },
              create: { studentId: id, sessionId: session.id, sectionId, rollNo: v.rollNo! },
            });
            if (v.guardianPhone) await this.roster.linkGuardian(tx, schoolId, id, v.guardianPhone, v.guardianName);
          });
        } catch (e) {
          result.failed.push({ line: r.line, error: (e as Error).message.slice(0, 200) });
        }
      }
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'DONE', committedAt: new Date(), summary: { ...(job.summary as object), result } as object } });
      await this.audit.record({ schoolId, actorId: actor.id, actorRole: actor.role, action: 'roster.import', entity: 'import', entityId: jobId, after: result, reason: job.fileName });
      return result;
    } catch (e) {
      await this.prisma.importJob.update({ where: { id: jobId }, data: { status: 'FAILED' } });
      throw e;
    }
  }

  async errorsCsv(actor: AuthUser, jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.schoolId !== actor.schoolId) throw new NotFoundException('Import not found');
    const rows = (job.rows as unknown as ImportRow[]).filter((r) => r.errors.length || r.warnings.length);
    const esc = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = ['Line,Name,Class,Section,Roll No,Problem'];
    for (const r of rows) lines.push([r.line, esc(r.values.name ?? ''), esc(r.values.className ?? ''), esc(r.values.section ?? ''), esc(r.values.rollNo ?? ''), esc([...r.errors, ...r.warnings].join('; '))].join(','));
    return `﻿${lines.join('\r\n')}`;
  }

  /** Excel template with the columns LaalPen understands, two example rows and a help sheet. */
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'LaalPen';
    const ws = wb.addWorksheet('Students');
    ws.columns = [
      { header: 'Admission No', key: 'adm', width: 14 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Father Name', key: 'father', width: 22 },
      { header: 'Class', key: 'class', width: 10 },
      { header: 'Section', key: 'sec', width: 9 },
      { header: 'Roll No', key: 'roll', width: 9 },
      { header: 'Date of Birth', key: 'dob', width: 14 },
      { header: 'Gender', key: 'gender', width: 9 },
      { header: 'Guardian Name', key: 'gname', width: 20 },
      { header: 'Guardian Phone', key: 'phone', width: 16 },
      { header: 'Guardian Email', key: 'email', width: 24 },
      { header: 'B-Form', key: 'bform', width: 17 },
    ];
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8102E' } };
    ws.addRow({ adm: 'GR-1001', name: 'Ali Raza', father: 'Raza Ahmed', class: '9', sec: 'A', roll: '01', dob: '14/03/2011', gender: 'M', gname: 'Raza Ahmed', phone: '0300 1234567', email: '', bform: '' });
    ws.addRow({ adm: 'GR-1002', name: 'Ayesha Khan', father: 'Imran Khan', class: '9', sec: 'A', roll: '02', dob: '02/11/2010', gender: 'F', gname: 'Imran Khan', phone: '0321 7654321', email: 'imran@example.com', bform: '' });
    const help = wb.addWorksheet('Help');
    help.columns = [{ width: 110 }];
    [
      'How to fill this sheet (Roman Urdu: kaise bharen)',
      '',
      'Required: Name, Class, Roll No.  Section is A if empty.',
      'Admission No (GR number) is strongly recommended: when you upload the sheet again next month,',
      'students with the same Admission No are UPDATED, not duplicated. Nobody is ever deleted by an upload.',
      'Date of Birth: DD/MM/YYYY (e.g. 14/03/2011). Students use it to claim their account.',
      'Guardian Phone: the parent\'s mobile (0300 1234567). One phone links all brothers and sisters.',
      'B-Form: optional, 13 digits. It is stored encrypted and only the last 4 digits are ever shown.',
      'Urdu column names also work: نام، جماعت، سیکشن، رول نمبر، فون',
      'Delete the two example rows before uploading.',
    ].forEach((t) => help.addRow([t]));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
