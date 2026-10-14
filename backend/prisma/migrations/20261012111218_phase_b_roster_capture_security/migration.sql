-- CreateEnum
CREATE TYPE "StudentStatus" AS ENUM ('ACTIVE', 'LEFT', 'GRADUATED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EnrollmentState" AS ENUM ('ACTIVE', 'PROMOTED', 'LEFT', 'GRADUATED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'CLOSED', 'DONE');

-- CreateEnum
CREATE TYPE "GradingMode" AS ENUM ('INSTANT', 'OVERNIGHT');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'PHONE_LOGIN';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PARENT';

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_userId_fkey";

-- DropIndex
DROP INDEX "student_profiles_sectionId_rollNo_idx";

-- DropIndex
DROP INDEX "student_profiles_sectionId_status_idx";

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "clientLocalId" TEXT,
ADD COLUMN     "qrCode" TEXT;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "cropRegion" JSONB;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "copyRetentionDays" INTEGER;

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "joinCode" TEXT,
ADD COLUMN     "joinCodeExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "claim_requests" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rollNo" TEXT NOT NULL,
    "dob" DATE,
    "admissionNo" TEXT,
    "guardianPhone" TEXT,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "matchedStudentId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_requests_pkey" PRIMARY KEY ("id")
);

-- Roster-first student records: every student now belongs to a school, has a name of its own and may exist without an app account
ALTER TABLE "student_profiles"
  ADD COLUMN "admissionNo" TEXT,
  ADD COLUMN "bFormEnc" TEXT,
  ADD COLUMN "bFormLast4" TEXT,
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "dob" DATE,
  ADD COLUMN "fatherName" TEXT,
  ADD COLUMN "gender" TEXT,
  ADD COLUMN "name" TEXT,
  ADD COLUMN "schoolId" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "userId" DROP NOT NULL;

UPDATE "student_profiles" p SET "schoolId" = c."schoolId"
  FROM "sections" s JOIN "classes" c ON c."id" = s."classId" WHERE s."id" = p."sectionId";
UPDATE "student_profiles" p SET "name" = u."name" FROM "users" u WHERE u."id" = p."userId";
UPDATE "student_profiles" SET "name" = 'Student ' || "rollNo" WHERE "name" IS NULL;
ALTER TABLE "student_profiles" ALTER COLUMN "name" SET NOT NULL, ALTER COLUMN "schoolId" SET NOT NULL;

-- old self sign-ups that were still waiting (or rejected) become claim requests; the roster keeps only real students
INSERT INTO "claim_requests" ("id", "schoolId", "sectionId", "userId", "name", "rollNo", "guardianPhone", "status", "reviewedById", "reviewedAt", "rejectReason", "createdAt")
SELECT 'cr_' || p."id", p."schoolId", p."sectionId", p."userId", p."name", p."rollNo", p."guardianPhone",
       CASE WHEN p."status"::text = 'REJECTED' THEN 'REJECTED'::"ClaimStatus" ELSE 'PENDING'::"ClaimStatus" END,
       p."reviewedById", p."reviewedAt", p."rejectReason", p."createdAt"
  FROM "student_profiles" p WHERE p."status"::text <> 'APPROVED' AND p."userId" IS NOT NULL;
DELETE FROM "student_profiles" WHERE "status"::text <> 'APPROVED';

ALTER TABLE "student_profiles" DROP COLUMN "rejectReason", DROP COLUMN "reviewedAt", DROP COLUMN "reviewedById", DROP COLUMN "status";
ALTER TABLE "student_profiles" ADD COLUMN "status" "StudentStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "student_profiles" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "aiBatchId" TEXT,
ADD COLUMN     "batchCounted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "voiceNotePath" TEXT;

-- AlterTable
ALTER TABLE "tests" ADD COLUMN     "gradingMode" "GradingMode" NOT NULL DEFAULT 'INSTANT',
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phoneE164" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- DropEnum
DROP TYPE "EnrollmentStatus";

-- CreateTable
CREATE TABLE "academic_sessions" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "rollNo" TEXT NOT NULL,
    "state" "EnrollmentState" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_guardians" (
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "relation" TEXT,

    CONSTRAINT "student_guardians_pkey" PRIMARY KEY ("studentId","guardianId")
);

-- CreateTable
CREATE TABLE "claim_codes" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STUDENT',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRY_RUN',
    "summary" JSONB NOT NULL,
    "rows" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT,
    "deviceLabel" TEXT,
    "ip" TEXT,
    "method" TEXT NOT NULL DEFAULT 'password',
    "stepUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT,
    "actorId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comment_bank" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "lang" TEXT NOT NULL DEFAULT 'en',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comment_bank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_batches" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "problems" INTEGER NOT NULL DEFAULT 0,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "grading_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_batches" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerBatchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "submissionIds" TEXT[],
    "runs" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ai_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_stats" (
    "testId" TEXT NOT NULL,
    "approved" INTEGER NOT NULL DEFAULT 0,
    "sumPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "perQuestion" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_stats_pkey" PRIMARY KEY ("testId")
);

-- CreateIndex
CREATE UNIQUE INDEX "academic_sessions_schoolId_name_key" ON "academic_sessions"("schoolId", "name");

-- CreateIndex
CREATE INDEX "enrollments_sectionId_sessionId_idx" ON "enrollments"("sectionId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_studentId_sessionId_key" ON "enrollments"("studentId", "sessionId");

-- CreateIndex
CREATE INDEX "guardians_userId_idx" ON "guardians"("userId");

-- CreateIndex
CREATE INDEX "guardians_phone_idx" ON "guardians"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_schoolId_phone_key" ON "guardians"("schoolId", "phone");

-- CreateIndex
CREATE INDEX "student_guardians_guardianId_idx" ON "student_guardians"("guardianId");

-- CreateIndex
CREATE INDEX "claim_requests_sectionId_status_idx" ON "claim_requests"("sectionId", "status");

-- CreateIndex
CREATE INDEX "claim_requests_schoolId_status_idx" ON "claim_requests"("schoolId", "status");

-- CreateIndex
CREATE INDEX "claim_requests_userId_idx" ON "claim_requests"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "claim_codes_codeHash_key" ON "claim_codes"("codeHash");

-- CreateIndex
CREATE INDEX "claim_codes_studentId_idx" ON "claim_codes"("studentId");

-- CreateIndex
CREATE INDEX "import_jobs_schoolId_createdAt_idx" ON "import_jobs"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "sessions_userId_revokedAt_idx" ON "sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "audit_logs_schoolId_createdAt_idx" ON "audit_logs"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_createdAt_idx" ON "audit_logs"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "comment_bank_teacherId_uses_idx" ON "comment_bank"("teacherId", "uses");

-- CreateIndex
CREATE UNIQUE INDEX "comment_bank_teacherId_text_key" ON "comment_bank"("teacherId", "text");

-- CreateIndex
CREATE INDEX "grading_batches_testId_createdAt_idx" ON "grading_batches"("testId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_batches_status_idx" ON "ai_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pages_clientLocalId_key" ON "pages"("clientLocalId");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_idx" ON "refresh_tokens"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "sections_joinCode_key" ON "sections"("joinCode");

-- CreateIndex
CREATE INDEX "student_profiles_sectionId_status_rollNo_idx" ON "student_profiles"("sectionId", "status", "rollNo");

-- CreateIndex
CREATE INDEX "student_profiles_schoolId_status_idx" ON "student_profiles"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_schoolId_admissionNo_key" ON "student_profiles"("schoolId", "admissionNo");

-- CreateIndex
CREATE INDEX "submissions_batchId_idx" ON "submissions"("batchId");

-- CreateIndex
CREATE INDEX "submissions_schoolId_status_idx" ON "submissions"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_phoneE164_key" ON "users"("phoneE164");

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_guardians" ADD CONSTRAINT "student_guardians_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_requests" ADD CONSTRAINT "claim_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_codes" ADD CONSTRAINT "claim_codes_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tests" ADD CONSTRAINT "tests_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "grading_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comment_bank" ADD CONSTRAINT "comment_bank_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_batches" ADD CONSTRAINT "grading_batches_testId_fkey" FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_stats" ADD CONSTRAINT "test_stats_testId_fkey" FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===================== data for existing schools =====================

-- every school gets a current academic session (Pakistani year: April to March)
INSERT INTO "academic_sessions" ("id", "schoolId", "name", "startsOn", "isCurrent")
SELECT 'as_' || sc."id",
       sc."id",
       CASE WHEN EXTRACT(MONTH FROM now()) >= 4
            THEN EXTRACT(YEAR FROM now())::int || '-' || LPAD(((EXTRACT(YEAR FROM now())::int + 1) % 100)::text, 2, '0')
            ELSE (EXTRACT(YEAR FROM now())::int - 1) || '-' || LPAD((EXTRACT(YEAR FROM now())::int % 100)::text, 2, '0') END,
       make_date(CASE WHEN EXTRACT(MONTH FROM now()) >= 4 THEN EXTRACT(YEAR FROM now())::int ELSE EXTRACT(YEAR FROM now())::int - 1 END, 4, 1),
       true
  FROM "schools" sc;

INSERT INTO "enrollments" ("id", "studentId", "sessionId", "sectionId", "rollNo")
SELECT 'en_' || p."id", p."id", 'as_' || p."schoolId", p."sectionId", p."rollNo" FROM "student_profiles" p;

UPDATE "tests" t SET "schoolId" = sub."schoolId", "sessionId" = 'as_' || sub."schoolId"
  FROM "teaching_assignments" a JOIN "subjects" sub ON sub."id" = a."subjectId" WHERE a."id" = t."assignmentId";
UPDATE "submissions" s SET "schoolId" = t."schoolId" FROM "tests" t WHERE t."id" = s."testId";

-- guardians by phone (+92 format) so one parent login sees all their children
WITH phones AS (
  SELECT p."id" AS student_id, p."schoolId", p."guardianName",
         regexp_replace(p."guardianPhone", '[^0-9]', '', 'g') AS d
    FROM "student_profiles" p WHERE p."guardianPhone" IS NOT NULL
), norm AS (
  SELECT student_id, "schoolId", "guardianName",
         CASE WHEN d LIKE '92%' AND length(d) = 12 THEN '+' || d
              WHEN d LIKE '03%' AND length(d) = 11 THEN '+92' || substr(d, 2)
              WHEN d LIKE '3%' AND length(d) = 10 THEN '+92' || d END AS phone
    FROM phones
)
INSERT INTO "guardians" ("id", "schoolId", "phone", "name")
SELECT DISTINCT ON ("schoolId", phone) 'gd_' || md5("schoolId" || phone), "schoolId", phone, "guardianName"
  FROM norm WHERE phone IS NOT NULL AND phone <> '+920000000000'
ON CONFLICT DO NOTHING;

INSERT INTO "student_guardians" ("studentId", "guardianId")
SELECT p."id", g."id" FROM "student_profiles" p
  JOIN "guardians" g ON g."schoolId" = p."schoolId" AND g."phone" = (
    CASE WHEN regexp_replace(p."guardianPhone", '[^0-9]', '', 'g') LIKE '92%' THEN '+' || regexp_replace(p."guardianPhone", '[^0-9]', '', 'g')
         WHEN regexp_replace(p."guardianPhone", '[^0-9]', '', 'g') LIKE '03%' THEN '+92' || substr(regexp_replace(p."guardianPhone", '[^0-9]', '', 'g'), 2)
         ELSE '+92' || regexp_replace(p."guardianPhone", '[^0-9]', '', 'g') END)
ON CONFLICT DO NOTHING;

-- problem copies stay a tiny index however big the school gets
CREATE INDEX "submissions_problems_idx" ON "submissions" ("testId") WHERE "status" IN ('NEEDS_ATTENTION', 'FAILED');

-- ===================== append-only audit log =====================
CREATE OR REPLACE FUNCTION laalpen_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION laalpen_audit_append_only();

-- ===================== row-level security for student / parent reads =====================
-- Student and parent screens run their queries inside a transaction that switches to the read-only
-- role "laalpen_rls" and sets app.school_id. Postgres itself then hides every other school's rows,
-- even if application code had a bug. Normal (owner) connections are not affected.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'laalpen_rls') THEN
    CREATE ROLE laalpen_rls NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  EXECUTE format('GRANT laalpen_rls TO %I', current_user);
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Could not create role laalpen_rls (no CREATEROLE privilege); database-level isolation is skipped, application checks still apply.';
END $$;

DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'laalpen_rls') THEN RETURN; END IF;
  GRANT USAGE ON SCHEMA public TO laalpen_rls;
  FOREACH t IN ARRAY ARRAY['users','student_profiles','tests','submissions','answers','pages','questions','teaching_assignments','subjects','sections','classes','schools','guardians','student_guardians','academic_sessions','enrollments'] LOOP
    EXECUTE format('GRANT SELECT ON %I TO laalpen_rls', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['users','student_profiles','tests','submissions','guardians'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_all ON %I TO PUBLIC USING (current_user <> %L) WITH CHECK (current_user <> %L)', t, 'laalpen_rls', 'laalpen_rls');
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO laalpen_rls USING ("schoolId" = current_setting(%L, true))', t, 'app.school_id');
  END LOOP;
  FOREACH t IN ARRAY ARRAY['answers','pages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY app_all ON %I TO PUBLIC USING (current_user <> %L) WITH CHECK (current_user <> %L)', t, 'laalpen_rls', 'laalpen_rls');
    EXECUTE format('CREATE POLICY tenant_read ON %I FOR SELECT TO laalpen_rls USING (EXISTS (SELECT 1 FROM submissions s WHERE s.id = "submissionId"))', t);
  END LOOP;
END $$;
