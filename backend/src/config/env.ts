import 'dotenv/config';

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number(v) : fallback;
}

/** All configuration in one place. Values come from backend/.env (see .env.example). */
export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: num('PORT', 4000),
  databaseUrl: str('DATABASE_URL'),
  /** direct (non-pooled) connection for the job queue; pg-boss needs LISTEN/NOTIFY, which poolers break */
  get directDatabaseUrl(): string {
    return process.env.DIRECT_DATABASE_URL || this.databaseUrl;
  },
  /** "all" (default): API + queue workers in one process; "api" or "worker" to scale them separately */
  processRole: str('LAALPEN_ROLE', 'all') as 'all' | 'api' | 'worker',
  corsOrigins: str('CORS_ORIGINS', '*'),

  jwtAccessSecret: str('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  jwtAccessTtl: str('JWT_ACCESS_TTL', '15m'),
  refreshTtlDays: num('REFRESH_TTL_DAYS', 30),
  fileSigningSecret: str('FILE_SIGNING_SECRET', 'dev-file-secret-change-me'),
  fileUrlTtlMinutes: num('FILE_URL_TTL_MINUTES', 120),

  uploadDir: str('UPLOAD_DIR', './uploads'),
  maxUploadMb: num('MAX_UPLOAD_MB', 12),

  aiServiceUrl: str('AI_SERVICE_URL', 'http://localhost:8000'),
  aiServiceToken: str('AI_SERVICE_TOKEN', 'dev-ai-token'),
  checkingConcurrency: num('CHECKING_CONCURRENCY', 2),
  /** workers for copies a teacher is waiting on (single uploads, re-checks) */
  checkInteractiveConcurrency: num('CHECK_INTERACTIVE_CONCURRENCY', 2),
  /** workers for whole-class capture sessions */
  checkBulkConcurrency: num('CHECK_BULK_CONCURRENCY', 2),
  /** AI calls per minute for ALL workers together (set to your OpenAI RPM / 3, self-consistency re-asks included) */
  get aiRequestsPerMinute() {
    return num('AI_REQUESTS_PER_MINUTE', 60);
  },

  brevoApiKey: process.env.BREVO_API_KEY || '',
  mailFromEmail: str('MAIL_FROM_EMAIL', 'no-reply@laalpen.app'),
  mailFromName: str('MAIL_FROM_NAME', 'LaalPen'),
  appUrl: str('APP_URL', 'http://localhost:8081'),
  /** passkeys (WebAuthn): the site's domain and the web addresses allowed to use them */
  get webauthnRpId() {
    return process.env.WEBAUTHN_RP_ID || new URL(process.env.APP_URL || 'http://localhost:8081').hostname;
  },
  get webauthnOrigins() {
    return (process.env.WEBAUTHN_ORIGINS || process.env.APP_URL || 'http://localhost:8081').split(',').map((s) => s.trim()).filter(Boolean);
  },
  /** deep-link scheme of the mobile app (must match app.config.ts) */
  appScheme: str('APP_SCHEME', 'laalpen'),
  /** public address of this API (used in email links such as "this wasn't me") */
  publicApiUrl: str('PUBLIC_API_URL', 'http://localhost:4000'),

  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',

  otpTtlMinutes: num('OTP_TTL_MINUTES', 10),

  /** secret used to encrypt sensitive fields such as B-Form numbers */
  dataEncryptionKey: str('DATA_ENCRYPTION_KEY', 'dev-data-key-change-me-32-characters!!'),

  /** how often the "check now" queue looks for new copies (seconds); other queues poll less often */
  queuePollSeconds: Math.max(0.5, num('QUEUE_POLL_SECONDS', 2)),
  /** keep a free host (Render) awake: ping this public URL every KEEPALIVE_MINUTES during KEEPALIVE_HOURS (e.g. "9-21", TZ_SCHEDULE time) */
  keepAliveUrl: process.env.KEEPALIVE_URL || '',
  keepAliveHours: process.env.KEEPALIVE_HOURS || '',
  keepAliveMinutes: Math.min(14, Math.max(1, num('KEEPALIVE_MINUTES', 10))),

  // ----- file storage: "local" (free, on this computer), "db" (inside PostgreSQL: survives restarts on hosts
  //       without a disk, e.g. Render free) or "s3" (Cloudflare R2 / AWS S3 / any S3-compatible) -----
  storageDriver: str('STORAGE_DRIVER', 'local') as 'local' | 'db' | 's3',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: str('S3_REGION', 'auto'),
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKeyId: process.env.S3_ACCESS_KEY_ID || '',
  s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',

  // ----- SMS / WhatsApp (parent sign-in codes and result messages); "console" prints them -----
  smsProvider: str('SMS_PROVIDER', 'console') as 'console' | 'twilio' | 'http',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFrom: process.env.TWILIO_FROM || '',
  /** generic HTTP SMS gateway (most Pakistani SMS companies): {to} and {text} are replaced */
  smsHttpUrl: process.env.SMS_HTTP_URL || '',
  whatsappToken: process.env.WHATSAPP_TOKEN || '',
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  /** approved WhatsApp template names (Meta business manager) */
  whatsappOtpTemplate: str('WHATSAPP_OTP_TEMPLATE', 'laalpen_code'),
  whatsappResultTemplate: str('WHATSAPP_RESULT_TEMPLATE', 'laalpen_result'),

  /** days a shared result link (parents' WhatsApp) stays valid */
  shareLinkDays: num('SHARE_LINK_DAYS', 30),
  /** minutes after a password / authenticator check during which sensitive actions are allowed */
  stepUpMinutes: num('STEP_UP_MINUTES', 10),
  /** when overnight tests are sent to the half-price Batch API (cron, server time zone) */
  overnightCron: str('OVERNIGHT_CRON', '0 21 * * *'),
  /** time zone for scheduled jobs */
  timezone: str('TZ_SCHEDULE', 'Asia/Karachi'),

  /** 32+ character secret that encrypts authenticator (TOTP) secrets in the database */
  totpEncryptionKey: str('TOTP_ENCRYPTION_KEY', 'dev-totp-key-change-me-32-characters!!'),
  /** principals/admins must use an authenticator app (recommended: true) */
  get requireAdmin2fa() {
    return (process.env.REQUIRE_ADMIN_2FA ?? 'true') !== 'false';
  },
  /** roles that must confirm a new device with an emailed code when they have no authenticator app */
  get deviceConfirmRoles(): string[] {
    return (process.env.DEVICE_CONFIRM_ROLES ?? 'TEACHER').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
  },
  /** email domains that skip the new-device email code because nobody can receive mail there (e.g. the shared demo school "laalpen.demo") */
  get deviceConfirmSkipDomains(): string[] {
    return (process.env.DEVICE_CONFIRM_SKIP_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  },
  /** check new passwords against the Have I Been Pwned breach list (k-anonymity, only 5 hash chars leave the server) */
  get breachedPasswordCheck() {
    return (process.env.BREACHED_PASSWORD_CHECK ?? 'true') !== 'false';
  },
  /** lock an account for a while after this many wrong passwords in a row */
  maxFailedLogins: num('MAX_FAILED_LOGINS', 10),
  lockMinutes: num('LOCK_MINUTES', 15),
  get isProd() {
    return this.nodeEnv === 'production';
  },
  get isTest() {
    return this.nodeEnv === 'test';
  },
};

/**
 * Refuse to start a production server that still uses the development defaults:
 * a "change-me" JWT/encryption secret lets anyone forge logins or read encrypted data.
 */
export function productionConfigProblems(e: { isProd: boolean; corsOrigins: string } & Record<string, unknown> = env as never): string[] {
  if (!e.isProd) return [];
  const problems: string[] = [];
  for (const k of ['jwtAccessSecret', 'fileSigningSecret', 'dataEncryptionKey', 'totpEncryptionKey']) {
    const v = String(e[k] ?? '');
    if (!v || /change-me/i.test(v) || v.length < 32) problems.push(`${k} is a development default or shorter than 32 characters`);
  }
  if (e.corsOrigins === '*') problems.push('CORS_ORIGINS is "*"; list the app and website origins');
  return problems;
}
