-- DropIndex
DROP INDEX "student_profiles_sectionId_rollNo_key";

-- CreateIndex
CREATE INDEX "student_profiles_sectionId_rollNo_idx" ON "student_profiles"("sectionId", "rollNo");

