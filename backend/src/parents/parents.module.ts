import { Module } from '@nestjs/common';
import { ParentsController } from './parents.controller.js';
import { ParentsService } from './parents.service.js';
import { RosterModule } from '../roster/roster.module.js';
import { StudentModule } from '../student/student.module.js';

@Module({ imports: [RosterModule, StudentModule], controllers: [ParentsController], providers: [ParentsService] })
export class ParentsModule {}
