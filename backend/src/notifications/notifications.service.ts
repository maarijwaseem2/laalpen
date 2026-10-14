import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationType } from '../generated/prisma/enums.js';
import { env } from '../config/env.js';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** In-app notifications (bell) + Expo push notifications (free). */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('Notifications');
  constructor(private readonly prisma: PrismaService) {}

  async notify(userIds: string[], input: NotifyInput) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return;
    await this.prisma.notification.createMany({
      data: ids.map((userId) => ({ userId, type: input.type, title: input.title, body: input.body, data: input.data as object })),
    });
    const tokens = await this.prisma.pushToken.findMany({ where: { userId: { in: ids } } });
    if (tokens.length && !env.isTest) void this.push(tokens.map((t) => t.token), input);
  }

  private async push(tokens: string[], input: NotifyInput) {
    try {
      const messages = tokens.map((to) => ({ to, title: input.title, body: input.body, data: input.data ?? {}, sound: 'default' }));
      for (let i = 0; i < messages.length; i += 100) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(messages.slice(i, i + 100)),
        });
      }
    } catch (e) {
      this.log.warn(`Push failed: ${(e as Error).message}`);
    }
  }

  /** Teachers of a section + the school's admins (people who can approve a join request). */
  async notifySectionReviewers(sectionId: string, msg: { title: string; body: string }) {
    const section = await this.prisma.section.findUnique({ where: { id: sectionId }, include: { schoolClass: true, teaching: true } });
    if (!section) return;
    const admins = await this.prisma.user.findMany({ where: { schoolId: section.schoolClass.schoolId, role: 'ADMIN', isActive: true }, select: { id: true } });
    await this.notify([...section.teaching.map((t) => t.teacherId), ...admins.map((a) => a.id)], {
      type: 'ACCOUNT',
      title: msg.title,
      body: msg.body,
      data: { joinRequests: 'true', sectionId },
    });
  }

  list(userId: string, take = 30, cursor?: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      // keyset (cursor) pagination on the (userId, createdAt, id) index: page 50 costs the same as page 1
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }

  async removePushToken(userId: string, token: string) {
    await this.prisma.pushToken.deleteMany({ where: { userId, token } });
  }

  async registerPushToken(userId: string, token: string, platform?: string) {
    await this.prisma.pushToken.upsert({ where: { token }, update: { userId, platform }, create: { userId, token, platform } });
  }
}
