import { Module } from '@nestjs/common';
import { SchoolController, TeacherProfileController } from './school.controller.js';
import { SchoolService } from './school.service.js';

@Module({ controllers: [SchoolController, TeacherProfileController], providers: [SchoolService] })
export class SchoolModule {}
