import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Defence in depth for multi-school data. Student and parent screens read inside a transaction that
 * switches to the read-only database role "laalpen_rls" and sets app.school_id; PostgreSQL row-level
 * security then hides every other school's rows even if application code had a bug.
 * If the role could not be created (no CREATEROLE on the database), the normal application checks still apply.
 */
@Injectable()
export class TenantService {
  private readonly log = new Logger('Tenant');
  private roleOk: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async hasRole() {
    if (this.roleOk === null) {
      const rows = await this.prisma.$queryRaw<{ ok: boolean }[]>`SELECT pg_has_role(current_user, 'laalpen_rls', 'MEMBER') AS ok FROM pg_roles WHERE rolname = 'laalpen_rls'`.catch(() => []);
      this.roleOk = !!rows[0]?.ok;
      if (!this.roleOk) this.log.warn('Role laalpen_rls missing: database row-level security is not active (application checks still apply).');
    }
    return this.roleOk;
  }

  /** Runs read-only queries that can only ever see this school's rows. */
  async read<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const rls = await this.hasRole();
    return this.prisma.$transaction(async (tx) => {
      if (rls) await tx.$executeRawUnsafe('SET LOCAL ROLE laalpen_rls');
      await tx.$executeRaw`SELECT set_config('app.school_id', ${schoolId}, true)`;
      return fn(tx);
    });
  }

  get active() {
    return this.roleOk === true;
  }
}
