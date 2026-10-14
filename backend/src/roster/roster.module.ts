import { Module } from '@nestjs/common';
import { RosterService } from './roster.service.js';
import { ImportService } from './import.service.js';
import { CardsService } from './cards.service.js';
import { AdminRosterController, TeacherRosterController } from './roster.controller.js';

@Module({
  controllers: [AdminRosterController, TeacherRosterController],
  providers: [RosterService, ImportService, CardsService],
  exports: [RosterService, CardsService],
})
export class RosterModule {}
