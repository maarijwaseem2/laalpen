-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('SURE', 'CHECK', 'UNREADABLE');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('THEORY', 'NUMERIC', 'MCQ');

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "ProblemType" AS ENUM ('BLURRY', 'DARK', 'GLARE', 'CUT_OFF', 'LOW_RESOLUTION', 'BLANK_PAGE', 'DUPLICATE', 'MISSING_PAGES', 'WRONG_STUDENT', 'CHECK_FAILED');

-- CreateEnum
CREATE TYPE "ChallengeKind" AS ENUM ('TOTP', 'EMAIL_DEVICE');

-- AlterEnum
ALTER TYPE "OtpPurpose" ADD VALUE 'DEVICE_CONFIRM';

-- AlterEnum
ALTER TYPE "SubmissionStatus" ADD VALUE 'NEEDS_ATTENTION';

-- DropIndex
DROP INDEX "tests_assignmentId_idx";

-- AlterTable
ALTER TABLE "answers" ADD COLUMN     "aiComment" TEXT,
ADD COLUMN     "isBlank" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "keyVersion" INTEGER,
ADD COLUMN     "legibility" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "reviewState" "ReviewState" NOT NULL DEFAULT 'SURE',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "ruleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "samples" JSONB;

-- AlterTable
ALTER TABLE "pages" ADD COLUMN     "blurScore" DOUBLE PRECISION,
ADD COLUMN     "brightness" DOUBLE PRECISION,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "phash" TEXT,
ADD COLUMN     "qualityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "testId" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "alternatives" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "finalAnswer" TEXT,
ADD COLUMN     "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rules" JSONB,
ADD COLUMN     "steps" JSONB,
ADD COLUMN     "topic" TEXT,
ADD COLUMN     "type" "QuestionType" NOT NULL DEFAULT 'THEORY';

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "keyVersion" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "qualityChecked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "qualityOverride" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tests" ADD COLUMN     "expectedPages" INTEGER,
ADD COLUMN     "keyConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "keyStatus" "KeyStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "keyVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "answer_key_versions" (
    "id" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "questions" JSONB NOT NULL,
    "confirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "answer_key_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problem_copies" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "type" "ProblemType" NOT NULL,
    "pageNo" INTEGER,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "problem_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "testId" TEXT,
    "submissionId" TEXT,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 1,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_buckets" (
    "name" TEXT NOT NULL,
    "tokens" DOUBLE PRECISION NOT NULL,
    "capacity" DOUBLE PRECISION NOT NULL,
    "refillPerSec" DOUBLE PRECISION NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_buckets_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "backup_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "known_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "label" TEXT,
    "lastIp" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ChallengeKind" NOT NULL,
    "deviceHash" TEXT,
    "deviceLabel" TEXT,
    "method" TEXT NOT NULL DEFAULT 'password',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "answer_key_versions_testId_version_key" ON "answer_key_versions"("testId", "version");

-- CreateIndex
CREATE INDEX "problem_copies_testId_resolvedAt_idx" ON "problem_copies"("testId", "resolvedAt");

-- CreateIndex
CREATE INDEX "problem_copies_submissionId_resolvedAt_idx" ON "problem_copies"("submissionId", "resolvedAt");

-- CreateIndex
CREATE INDEX "problem_copies_schoolId_resolvedAt_idx" ON "problem_copies"("schoolId", "resolvedAt");

-- CreateIndex
CREATE INDEX "ai_usage_schoolId_createdAt_idx" ON "ai_usage"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_testId_idx" ON "ai_usage"("testId");

-- CreateIndex
CREATE INDEX "backup_codes_userId_idx" ON "backup_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_userId_deviceHash_key" ON "known_devices"("userId", "deviceHash");

-- CreateIndex
CREATE INDEX "login_challenges_userId_createdAt_idx" ON "login_challenges"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_id_idx" ON "notifications"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "pages_testId_phash_idx" ON "pages"("testId", "phash");

-- CreateIndex
CREATE INDEX "submissions_testId_status_updatedAt_idx" ON "submissions"("testId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "submissions_studentId_createdAt_idx" ON "submissions"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "tests_assignmentId_createdAt_idx" ON "tests"("assignmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "answer_key_versions" ADD CONSTRAINT "answer_key_versions_testId_fkey" FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_copies" ADD CONSTRAINT "problem_copies_testId_fkey" FOREIGN KEY ("testId") REFERENCES "tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problem_copies" ADD CONSTRAINT "problem_copies_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_codes" ADD CONSTRAINT "backup_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: tests created before answer-key confirmation existed keep working (their key becomes version 1)
UPDATE "tests" t SET "keyStatus" = 'CONFIRMED', "keyVersion" = 1, "keyConfirmedAt" = t."createdAt"
WHERE EXISTS (SELECT 1 FROM "questions" q WHERE q."testId" = t."id");

INSERT INTO "answer_key_versions" ("id", "testId", "version", "questions", "createdAt")
SELECT 'akv_' || t."id", t."id", 1,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('number', q."number", 'text', q."text", 'maxMarks', q."maxMarks", 'answerKey', q."answerKey", 'type', 'THEORY') ORDER BY q."number")
                 FROM "questions" q WHERE q."testId" = t."id"), '[]'::jsonb),
       t."createdAt"
FROM "tests" t WHERE t."keyVersion" = 1;

UPDATE "pages" p SET "testId" = s."testId" FROM "submissions" s WHERE s."id" = p."submissionId";

-- copies that were already checked passed the old (simpler) photo gate
UPDATE "submissions" SET "qualityChecked" = true WHERE "status" <> 'PENDING';
UPDATE "answers" SET "reviewState" = 'CHECK' WHERE "needsReview" = true;
UPDATE "answers" SET "aiComment" = "comment" WHERE "teacherEdited" = false;
