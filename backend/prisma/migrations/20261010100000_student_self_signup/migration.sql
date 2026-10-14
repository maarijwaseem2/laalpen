-- Students can sign up themselves and wait for approval; every school gets a join code.

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: add the code as nullable, give existing schools a random code, then make it required
ALTER TABLE "schools" ADD COLUMN "joinCode" TEXT;
UPDATE "schools"
SET "joinCode" = UPPER(SUBSTRING(REGEXP_REPLACE("name", '[^A-Za-z]', '', 'g') FROM 1 FOR 3)) || '-' || LPAD((FLOOR(RANDOM() * 10000))::TEXT, 4, '0') || UPPER(SUBSTRING(MD5("id") FROM 1 FOR 2))
WHERE "joinCode" IS NULL;
ALTER TABLE "schools" ALTER COLUMN "joinCode" SET NOT NULL;

-- AlterTable
ALTER TABLE "student_profiles" ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "EnrollmentStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE UNIQUE INDEX "schools_joinCode_key" ON "schools"("joinCode");

-- CreateIndex
CREATE INDEX "student_profiles_sectionId_status_idx" ON "student_profiles"("sectionId", "status");
