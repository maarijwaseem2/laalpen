-- Multi-school roles (keeps every existing row):
--   * the school "ADMIN" becomes "PRINCIPAL"; a platform-wide SUPER_ADMIN is added
--   * staff sign in with emailed one-time codes (LOGIN_CODE / STEP_UP)
--   * teachers fill in a profile that the principal approves (teacher_profiles)
--   * schools get a profile (address, phone, logo) and can be suspended

ALTER TYPE "Role" RENAME VALUE 'ADMIN' TO 'PRINCIPAL';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN' BEFORE 'PRINCIPAL';

ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'LOGIN_CODE';
ALTER TYPE "OtpPurpose" ADD VALUE IF NOT EXISTS 'STEP_UP';

CREATE TYPE "TeacherStatus" AS ENUM ('PROFILE_INCOMPLETE', 'PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "schools"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "profileCompletedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendReason" TEXT,
  ADD COLUMN "createdById" TEXT;

-- schools that already exist (the demo school Al-Noor) are already set up
UPDATE "schools" SET "profileCompletedAt" = CURRENT_TIMESTAMP WHERE "profileCompletedAt" IS NULL;

ALTER TABLE "users"
  ADD COLUMN "passkeyFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "passkeyBlockedAt" TIMESTAMP(3),
  ADD COLUMN "invitedAt" TIMESTAMP(3),
  ADD COLUMN "invitedById" TEXT;

CREATE TABLE "teacher_profiles" (
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "phone" TEXT,
    "qualification" TEXT,
    "subjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sections" JSONB NOT NULL DEFAULT '[]',
    "status" "TeacherStatus" NOT NULL DEFAULT 'PROFILE_INCOMPLETE',
    "rejectReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teacher_profiles_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "teacher_profiles_schoolId_status_idx" ON "teacher_profiles"("schoolId", "status");

ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teacher_profiles" ADD CONSTRAINT "teacher_profiles_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- teachers who already work in a school are approved, with what they already teach
INSERT INTO "teacher_profiles" ("userId", "schoolId", "phone", "subjects", "sections", "status", "submittedAt", "reviewedAt", "updatedAt")
SELECT u."id", u."schoolId", u."phone",
       COALESCE((SELECT ARRAY_AGG(DISTINCT s."name") FROM "teaching_assignments" ta JOIN "subjects" s ON s."id" = ta."subjectId" WHERE ta."teacherId" = u."id"), ARRAY[]::TEXT[]),
       COALESCE((SELECT JSONB_AGG(JSONB_BUILD_OBJECT('sectionId', ta."sectionId", 'subject', s."name")) FROM "teaching_assignments" ta JOIN "subjects" s ON s."id" = ta."subjectId" WHERE ta."teacherId" = u."id"), '[]'::JSONB),
       'APPROVED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE u."role" = 'TEACHER' AND u."schoolId" IS NOT NULL
ON CONFLICT ("userId") DO NOTHING;
