import { Module } from '@nestjs/common';
import { StudentController } from './student.controller.js';
import { StudentService } from './student.service.js';

@Module({ controllers: [StudentController], providers: [StudentService], exports: [StudentService] })
export class StudentModule {}
