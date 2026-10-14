import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StepUp, type AuthUser } from '../common/decorators.js';
import { AdminService } from './admin.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  AssignmentDto, CreateClassDto, CreateStudentDto, CreateTeacherDto, SectionDto, SubjectDto, UpdateClassDto,
  UpdateStudentDto, UpdateSubjectDto, UpdateTeacherDto,
} from './admin.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly audit: AuditService,
  ) {}

  /** School activity log (who changed what) — newest first. */
  @Get('audit') auditLog(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string) { return this.audit.list(u.schoolId!, cursor); }

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.svc.dashboard(u.schoolId); }

  @Get('classes') classes(@CurrentUser() u: AuthUser) { return this.svc.listClasses(u.schoolId); }
  @Post('classes') createClass(@CurrentUser() u: AuthUser, @Body() dto: CreateClassDto) { return this.svc.createClass(u.schoolId, dto); }
  @Patch('classes/:id') updateClass(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateClassDto) { return this.svc.updateClass(u.schoolId, id, dto); }
  @StepUp() @Delete('classes/:id') deleteClass(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteClass(u.schoolId, id); }
  @Post('classes/:id/sections') addSection(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SectionDto) { return this.svc.addSection(u.schoolId, id, dto.name); }

  @Get('sections/:id') section(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.sectionDetail(u.schoolId, id); }
  @Patch('sections/:id') renameSection(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SectionDto) { return this.svc.renameSection(u.schoolId, id, dto.name); }
  @Delete('sections/:id') deleteSection(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteSection(u.schoolId, id); }

  @Get('subjects') subjects(@CurrentUser() u: AuthUser) { return this.svc.listSubjects(u.schoolId); }
  @Post('subjects') createSubject(@CurrentUser() u: AuthUser, @Body() dto: SubjectDto) { return this.svc.createSubject(u.schoolId, dto); }
  @Patch('subjects/:id') updateSubject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateSubjectDto) { return this.svc.updateSubject(u.schoolId, id, dto); }
  @Delete('subjects/:id') deleteSubject(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteSubject(u.schoolId, id); }

  @Get('teachers') teachers(@CurrentUser() u: AuthUser, @Query('search') search?: string) { return this.svc.listTeachers(u.schoolId, search); }
  @Post('teachers') createTeacher(@CurrentUser() u: AuthUser, @Body() dto: CreateTeacherDto) { return this.svc.createTeacher(u.schoolId, dto); }
  @Patch('teachers/:id') updateTeacher(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateTeacherDto) { return this.svc.updateTeacher(u.schoolId, id, dto); }
  @StepUp() @Delete('teachers/:id') deleteTeacher(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteTeacher(u.schoolId, id); }

  @Post('assignments') assign(@CurrentUser() u: AuthUser, @Body() dto: AssignmentDto) { return this.svc.assign(u.schoolId, dto); }
  @Delete('assignments/:id') unassign(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.unassign(u.schoolId, id); }

  @Get('students') students(@CurrentUser() u: AuthUser, @Query('sectionId') sectionId?: string, @Query('search') search?: string, @Query('status') status?: 'ACTIVE' | 'LEFT' | 'GRADUATED' | 'ALL' | 'APPROVED', @Query('cursor') cursor?: string, @Query('take') take?: string) { return this.svc.listStudents(u.schoolId, sectionId, search, status ?? 'ACTIVE', cursor, take ? Number(take) : 300); }
  @Get('ai-usage') aiUsage(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.svc.aiUsage(u.schoolId, days ? Number(days) : 30); }
  @Post('students') createStudent(@CurrentUser() u: AuthUser, @Body() dto: CreateStudentDto) { return this.svc.createStudent(u.schoolId, dto, u); }
  @Patch('students/:id') updateStudent(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateStudentDto) { return this.svc.updateStudent(u.schoolId, id, dto, u); }
  @StepUp() @Delete('students/:id') deleteStudent(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteStudent(u.schoolId, id, u); }
}
