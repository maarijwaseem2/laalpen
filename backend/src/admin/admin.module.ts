import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { RosterModule } from '../roster/roster.module.js';

@Module({ imports: [RosterModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
