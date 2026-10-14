import { Module } from '@nestjs/common';
import { RosterModule } from '../roster/roster.module.js';
import { TeacherController } from './teacher.controller.js';
import { TeacherService } from './teacher.service.js';

@Module({ imports: [RosterModule], controllers: [TeacherController], providers: [TeacherService] })
export class TeacherModule {}
