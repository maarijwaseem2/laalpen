import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  schoolId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/**
 * Append-only history: who changed which mark, approved, published, re-opened, imported or deleted what.
 * The database refuses UPDATE/DELETE on audit_logs, so the history cannot be edited afterwards.
 */
@Injectable()
export class AuditService {
  private readonly log = new Logger('Audit');
  constructor(private readonly prisma: PrismaService) {}

  async record(e: AuditEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          schoolId: e.schoolId ?? null,
          actorId: e.actorId ?? null,
          actorRole: e.actorRole ?? null,
          action: e.action,
          entity: e.entity,
          entityId: e.entityId,
          before: (e.before ?? undefined) as object | undefined,
          after: (e.after ?? undefined) as object | undefined,
          reason: e.reason ?? null,
          ip: e.ip ?? null,
        },
      });
    } catch (err) {
      // an audit failure must never block teaching work, but it must be visible in the logs
      this.log.error(`audit write failed for ${e.action} ${e.entity}/${e.entityId}: ${(err as Error).message}`);
    }
  }

  /** History of one copy: every mark change, approval and re-open, newest first, with names. */
  async history(entityIds: string[]) {
    const rows = await this.prisma.auditLog.findMany({ where: { entityId: { in: entityIds } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 });
    const actors = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorId).filter(Boolean) as string[])] } }, select: { id: true, name: true } });
    const name = new Map(actors.map((a) => [a.id, a.name]));
    return rows.map((r) => ({ id: r.id, at: r.createdAt, action: r.action, entity: r.entity, entityId: r.entityId, by: r.actorId ? (name.get(r.actorId) ?? 'Someone') : 'LaalPen', before: r.before, after: r.after, reason: r.reason }));
  }

  /** School-wide log for principals (keyset pagination). */
  async list(schoolId: string, cursor?: string, take = 50) {
    return this.prisma.auditLog.findMany({
      where: { schoolId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(take, 200),
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }
}
