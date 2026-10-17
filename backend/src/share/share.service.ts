import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { env } from '../config/env.js';
import { round1 } from '../common/util.js';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Light web view of one checked copy for parents on WhatsApp: no app, no login, small images.
 * The link is signed and expires (SHARE_LINK_DAYS); it shows only that one approved, published result.
 */
@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  token(submissionId: string, days = env.shareLinkDays) {
    const exp = Math.floor(Date.now() / 1000) + days * 86400;
    const sig = createHmac('sha256', env.fileSigningSecret).update(`share:${submissionId}:${exp}`).digest('base64url').slice(0, 22);
    return `${submissionId}.${exp}.${sig}`;
  }

  url(submissionId: string) {
    return `${env.publicApiUrl}/api/share/r/${this.token(submissionId)}`;
  }

  private verify(token: string) {
    const [id, expS, sig] = token.split('.');
    const exp = Number(expS);
    if (!id || !exp || !sig || exp < Date.now() / 1000) return null;
    const want = Buffer.from(createHmac('sha256', env.fileSigningSecret).update(`share:${id}:${exp}`).digest('base64url').slice(0, 22));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got) ? id : null;
  }

  /** Who may create a link: the teacher of the test, the school's admin, the student, or a linked parent. */
  async create(user: { id: string; role: string; schoolId: string | null }, submissionId: string) {
    const s = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { student: { include: { guardians: { include: { guardian: true } }, section: { include: { schoolClass: true } } } }, test: { include: { assignment: { include: { subject: true } } } } },
    });
    if (!s || s.status !== 'APPROVED' || s.test.status !== 'PUBLISHED') throw new NotFoundException('Only published results can be shared');
    const allowed =
      (user.role === 'TEACHER' && s.test.assignment.teacherId === user.id) ||
      (user.role === 'PRINCIPAL' && s.student.schoolId === user.schoolId) ||
      (user.role === 'STUDENT' && s.student.userId === user.id) ||
      (user.role === 'PARENT' && s.student.guardians.some((g) => g.guardian.userId === user.id));
    if (!allowed) throw new ForbiddenException('You cannot share this result');
    const url = this.url(s.id);
    const marks = `${s.obtainedMarks ?? 0}/${s.test.totalMarks}`;
    return {
      url,
      text: `${s.student.name} (${s.student.section.schoolClass.name} ${s.student.section.name}, roll ${s.student.rollNo}) — ${s.test.assignment.subject.name}: ${s.test.title} — ${marks}. Checked copy: ${url}`,
    };
  }

  async page(token: string): Promise<string> {
    const id = this.verify(token);
    if (!id) return this.shell('Link expired', '<p>This result link has expired. Ask the school or open the LaalPen app.</p>');
    const s = await this.prisma.submission.findUnique({
      where: { id },
      include: {
        pages: { orderBy: { pageNo: 'asc' } },
        answers: { include: { question: true } },
        student: { include: { section: { include: { schoolClass: true } }, school: true } },
        test: { include: { assignment: { include: { subject: true, teacher: { select: { name: true } } } } } },
      },
    });
    if (!s || s.status !== 'APPROVED' || s.test.status !== 'PUBLISHED') return this.shell('Not available', '<p>This result is not available any more.</p>');
    const pct = s.test.totalMarks ? round1(((s.obtainedMarks ?? 0) / s.test.totalMarks) * 100) : 0;
    const rows = s.answers
      .sort((a, b) => a.question.number - b.question.number)
      .map((a) => `<tr><td>Q${a.question.number}</td><td>${esc(a.question.text)}</td><td class="m">${esc(a.finalMarks ?? 0)}/${esc(a.question.maxMarks)}</td><td class="c">${esc(a.comment ?? '')}</td></tr>`)
      .join('');
    const imgs = s.pages.map((p) => `<img src="${esc(env.publicApiUrl + this.storage.signedUrl(p.annotatedPath ?? p.originalPath, 180))}" alt="Checked page ${p.pageNo}" loading="lazy">`).join('');
    const body = `
      <p class="school">${esc(s.student.school.name)}</p>
      <h1>${esc(s.student.name)}</h1>
      <p class="sub">${esc(s.student.section.schoolClass.name)} ${esc(s.student.section.name)} · Roll ${esc(s.student.rollNo)}</p>
      <div class="score"><span>${esc(s.obtainedMarks ?? 0)}</span><i></i><span>${esc(s.test.totalMarks)}</span></div>
      <p class="test">${esc(s.test.assignment.subject.name)} — ${esc(s.test.title)} (${pct}%)</p>
      ${s.aiSummary ? `<p class="note">Teacher's note: ${esc(s.aiSummary)}</p>` : ''}
      <table>${rows}</table>
      <h2>Checked copy</h2>${imgs}
      <p class="foot">Checked with LaalPen · approved by ${esc(s.test.assignment.teacher.name)}</p>`;
    return this.shell(`${s.student.name} — ${s.test.title}`, body);
  }

  private shell(title: string, body: string) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>
body{margin:0;background:#F6F7FB;color:#1B2A4A;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:20px 16px 40px}
.school{color:#C8102E;font-weight:700;margin:0}h1{margin:6px 0 0;font-size:24px}.sub,.test{color:#4A5672;margin:4px 0}
.score{width:92px;height:92px;border:3px solid #C8102E;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#C8102E;font:700 26px/1 Georgia,serif;margin:16px 0}
.score i{width:44px;height:2px;background:#C8102E;margin:3px 0}
.note{background:#fff;border:1px solid #DFE4EE;border-radius:12px;padding:12px}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;margin:12px 0}
td{padding:8px;border-bottom:1px solid #ECEFF6;vertical-align:top;font-size:14px}.m{white-space:nowrap;color:#C8102E;font-weight:700}.c{color:#C8102E}
img{width:100%;border-radius:10px;margin:8px 0;border:1px solid #DFE4EE}.foot{color:#6B7690;font-size:12px;margin-top:20px}
</style></head><body><main>${body}</main></body></html>`;
  }
}
