import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, type AuthUser } from '../common/decorators.js';
import { StudentService } from './student.service.js';

@ApiTags('student')
@ApiBearerAuth()
@Roles('STUDENT')
@Controller('student')
export class StudentController {
  constructor(private readonly svc: StudentService) {}

  @Get('dashboard') async dashboard(@CurrentUser() u: AuthUser) { return this.svc.dashboard(await this.svc.profileForUser(u.id)); }
  @Get('subjects/:id') async subject(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.subject(await this.svc.profileForUser(u.id), id); }
  @Get('results/:id') async result(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.result(await this.svc.profileForUser(u.id), id); }
  @Get('results') async history(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string) { return this.svc.history(await this.svc.profileForUser(u.id), cursor); }
}
