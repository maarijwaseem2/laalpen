import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, StepUp, type AuthUser } from '../common/decorators.js';
import { env } from '../config/env.js';
import { TeacherService } from './teacher.service.js';
import { CommentDto, ConfirmKeyDto, CreateTestDto, DraftKeyDto, GroupMarkDto, IdsDto, ReopenDto, UpdateAnswerDto, UpdateTestDto, UploadQueryDto } from './teacher.dto.js';

const photos = (n: number) => FilesInterceptor('pages', n, { limits: { fileSize: env.maxUploadMb * 1024 * 1024 } });

@ApiTags('teacher')
@ApiBearerAuth()
@Roles('TEACHER')
@Controller('teacher')
export class TeacherController {
  constructor(private readonly svc: TeacherService) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.svc.dashboard(u.id); }
  @Get('classes') classes(@CurrentUser() u: AuthUser) { return this.svc.classes(u.id); }
  @Get('assignments/:id') assignment(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.assignment(u.id, id); }
  @Post('assignments/:id/tests') createTest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: CreateTestDto) { return this.svc.createTest(u.id, id, dto); }

  @Get('tests/:id') test(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.test(u.id, id); }
  @Patch('tests/:id') updateTest(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateTestDto) { return this.svc.updateTest(u.id, id, dto); }
  @Delete('tests/:id') deleteTest(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteTest(u.id, id); }
  @HttpCode(200) @Post('tests/:id/approve-checked') approveAll(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approveAllChecked(u.id, id); }
  @HttpCode(200) @Post('tests/:id/publish') publish(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.publish(u.id, id); }
  @Get('tests/:id/problems') problems(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.problems(u.id, id); }

  // answer key: AI draft -> teacher confirms a numbered version
  @Get('tests/:id/answer-key') key(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.getKey(u.id, id); }
  @ApiConsumes('multipart/form-data')
  @HttpCode(200) @Post('tests/:id/answer-key/draft')
  @UseInterceptors(photos(6))
  draftKey(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: DraftKeyDto, @UploadedFiles() files: Express.Multer.File[]) {
    return this.svc.draftKey(u.id, id, dto.text, files ?? []);
  }
  @Put('tests/:id/answer-key') confirmKey(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ConfirmKeyDto) { return this.svc.confirmKey(u.id, id, dto); }

  @ApiConsumes('multipart/form-data')
  @Post('tests/:id/students/:studentId/copy')
  @UseInterceptors(photos(12))
  upload(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('studentId') studentId: string, @UploadedFiles() files: Express.Multer.File[], @Query() q: UploadQueryDto) {
    return this.svc.uploadCopy(u.id, id, studentId, files, q.mode ?? 'interactive');
  }

  @Get('submissions/:id') submission(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.submission(u.id, id); }
  @HttpCode(200) @Post('submissions/:id/recheck') recheck(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.recheck(u.id, id); }
  @HttpCode(200) @Post('submissions/:id/check-anyway') checkAnyway(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.checkAnyway(u.id, id); }
  @HttpCode(200) @Post('submissions/:id/approve') approve(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.approve(u.id, id); }
  @HttpCode(200) @Post('submissions/unapprove') unapprove(@CurrentUser() u: AuthUser, @Body() dto: IdsDto) { return this.svc.unapprove(u.id, dto.ids); }
  @HttpCode(200) @Post('problems/:id/dismiss') dismiss(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.dismissProblem(u.id, id); }
  @Patch('answers/:id') updateAnswer(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateAnswerDto) { return this.svc.updateAnswer(u.id, id, dto); }
  // grade by question + groups of identical answers
  @Get('tests/:id/questions/:number') byQuestion(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('number', ParseIntPipe) n: number) { return this.svc.byQuestion(u.id, id, n); }
  @HttpCode(200) @Post('tests/:id/group-marks') group(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: GroupMarkDto) { return this.svc.markGroup(u.id, id, dto.answerIds, dto.finalMarks, dto.comment); }

  // comment bank
  @Get('comments') comments(@CurrentUser() u: AuthUser, @Query('q') q?: string) { return this.svc.comments(u.id, q); }
  @Post('comments') addComment(@CurrentUser() u: AuthUser, @Body() dto: CommentDto) { return this.svc.addComment(u.id, dto.text, dto.lang); }
  @Delete('comments/:id') deleteComment(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.deleteComment(u.id, id); }

  // after publishing: re-open (needs a fresh password / authenticator check), history, check now, voice note
  @StepUp() @HttpCode(200) @Post('submissions/:id/reopen') reopen(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ReopenDto) { return this.svc.reopen(u, id, dto.reason); }
  @Get('submissions/:id/history') history(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.history(u.id, id); }
  @HttpCode(200) @Post('submissions/:id/check-now') checkNow(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.checkNow(u.id, id); }
  @HttpCode(200) @Post('submissions/:id/voice-note') @UseInterceptors(FileInterceptor('audio', { limits: { fileSize: 2 * 1024 * 1024 } }))
  voice(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) { return this.svc.saveVoiceNote(u.id, id, file); }

  @HttpCode(200) @Post('answers/:id/confirm') confirmAnswer(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.confirmAnswer(u.id, id); }
}
