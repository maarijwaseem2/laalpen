import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StepUp, type AuthUser } from '../common/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CardsDto, LeaveDto, PromoteDto, QuickAddDto, SessionDto } from '../admin/admin.dto.js';
import { RosterService } from './roster.service.js';
import { ImportService } from './import.service.js';
import { CardsService } from './cards.service.js';

/** Shared by admins and teachers: printable claim cards and class codes. */
async function cardsFor(prisma: PrismaService, roster: RosterService, cards: CardsService, u: AuthUser, dto: CardsDto) {
  const where = dto.studentIds?.length ? { id: { in: dto.studentIds } } : dto.sectionId ? { sectionId: dto.sectionId } : null;
  if (!where) throw new BadRequestException('Choose a section or students');
  const students = await prisma.studentProfile.findMany({ where: { ...where, schoolId: u.schoolId!, status: 'ACTIVE', ...(dto.kind !== 'PARENT' ? { userId: null } : {}) }, select: { id: true, sectionId: true } });
  if (u.role === 'TEACHER') {
    const mine = new Set((await prisma.teachingAssignment.findMany({ where: { teacherId: u.id }, select: { sectionId: true } })).map((a) => a.sectionId));
    if (students.some((s) => !mine.has(s.sectionId))) throw new ForbiddenException('You do not teach some of these students');
  }
  if (!students.length) throw new BadRequestException('Every student here already has an account');
  const codes = await roster.newClaimCodes(u.schoolId!, students.map((s) => s.id), dto.kind ?? 'STUDENT');
  const school = await prisma.school.findUniqueOrThrow({ where: { id: u.schoolId! } });
  const pdf = await cards.claimCardsPdf(school.name, codes, dto.kind ?? 'STUDENT');
  const file = await cards.publish(`exports/${u.schoolId}/cards-${Date.now()}.pdf`, pdf, 'application/pdf');
  return { url: file.url, count: codes.length };
}

@ApiTags('admin-roster')
@ApiBearerAuth()
@Roles('PRINCIPAL')
@Controller('admin')
export class AdminRosterController {
  constructor(
    private readonly roster: RosterService,
    private readonly imports: ImportService,
    private readonly cards: CardsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('sessions') sessions(@CurrentUser() u: AuthUser) { return this.roster.sessions(u.schoolId!); }
  @Post('sessions') createSession(@CurrentUser() u: AuthUser, @Body() dto: SessionDto) {
    const year = Number(dto.name.slice(0, 4));
    return this.roster.createSession(u.schoolId!, dto.name, dto.startsOn ? new Date(dto.startsOn) : new Date(Date.UTC(year, 3, 1)), dto.makeCurrent ?? false);
  }

  /** Year-end promotion: preview first, then (after re-entering the password) commit. */
  @HttpCode(200) @Post('promote/preview') previewPromote(@CurrentUser() u: AuthUser, @Body() dto: PromoteDto) { return this.roster.promote(u.schoolId!, u, { ...dto, dryRun: true }); }
  @StepUp() @HttpCode(200) @Post('promote') promote(@CurrentUser() u: AuthUser, @Body() dto: PromoteDto) { return this.roster.promote(u.schoolId!, u, { ...dto, dryRun: false }); }

  @HttpCode(200) @Post('students/:id/leave') leave(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: LeaveDto) { return this.roster.markLeft(u.schoolId!, id, u, dto.reason); }
  @HttpCode(200) @Post('students/:id/rejoin') rejoin(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.roster.rejoin(u.schoolId!, id, u); }
  @HttpCode(200) @Post('sections/:id/students') quickAdd(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: QuickAddDto) { return this.roster.quickAdd(u, id, dto.text); }
  @HttpCode(200) @Post('sections/:id/join-code') rotate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.roster.rotateSectionCode(u.schoolId!, id); }
  @HttpCode(200) @Post('claim-cards') claimCards(@CurrentUser() u: AuthUser, @Body() dto: CardsDto) { return cardsFor(this.prisma, this.roster, this.cards, u, dto); }

  // ---------- Excel / CSV import ----------

  @Get('import/template')
  async template(@CurrentUser() u: AuthUser) {
    const file = await this.cards.publish(`exports/${u.schoolId}/laalpen-students-template.xlsx`, await this.imports.template(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return { url: file.url };
  }

  @ApiConsumes('multipart/form-data')
  @HttpCode(200) @Post('import/students')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  dryRun(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Query('createMissing') createMissing?: string) {
    if (!file) throw new BadRequestException('Choose an Excel or CSV file');
    return this.imports.dryRun(u, file, { createMissing: createMissing === 'true' || createMissing === '1' });
  }

  @StepUp() @HttpCode(200) @Post('import/:id/commit') commit(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.imports.commit(u, id); }

  @Get('import/:id/errors')
  async errors(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const csv = await this.imports.errorsCsv(u, id);
    const file = await this.cards.publish(`exports/${u.schoolId}/import-${id}-problems.csv`, Buffer.from(csv, 'utf8'), 'text/csv');
    return { url: file.url };
  }

  @Get('imports')
  imports_(@CurrentUser() u: AuthUser) {
    return this.prisma.importJob.findMany({ where: { schoolId: u.schoolId! }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, fileName: true, status: true, summary: true, createdAt: true, committedAt: true } });
  }
}

@ApiTags('teacher-roster')
@ApiBearerAuth()
@Roles('TEACHER')
@Controller('teacher')
export class TeacherRosterController {
  constructor(
    private readonly roster: RosterService,
    private readonly cards: CardsService,
    private readonly prisma: PrismaService,
  ) {}

  private async ownSection(u: AuthUser, sectionId: string) {
    const a = await this.prisma.teachingAssignment.findFirst({ where: { teacherId: u.id, sectionId } });
    if (!a) throw new NotFoundException('Section not found');
  }

  /** Academies without a register: type or paste the class list. */
  @HttpCode(200) @Post('sections/:id/students') quickAdd(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: QuickAddDto) { return this.roster.quickAdd(u, id, dto.text); }

  @HttpCode(200) @Post('sections/:id/join-code')
  async rotate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.ownSection(u, id);
    return this.roster.rotateSectionCode(u.schoolId!, id);
  }

  @Get('sections/:id/join-code')
  async code(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.ownSection(u, id);
    const s = await this.prisma.section.findUniqueOrThrow({ where: { id }, select: { id: true, joinCode: true, joinCodeExpiresAt: true } });
    return s.joinCode && s.joinCodeExpiresAt && s.joinCodeExpiresAt > new Date() ? s : this.roster.rotateSectionCode(u.schoolId!, id);
  }

  @HttpCode(200) @Post('claim-cards') claimCards(@CurrentUser() u: AuthUser, @Body() dto: CardsDto) { return cardsFor(this.prisma, this.roster, this.cards, u, dto); }
}
