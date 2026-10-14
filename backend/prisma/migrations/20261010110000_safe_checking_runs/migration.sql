-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "checkRun" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "notifiedAt" TIMESTAMP(3);


-- results that were already published have been announced
UPDATE "submissions" s SET "notifiedAt" = t."publishedAt"
FROM "tests" t WHERE s."testId" = t."id" AND s."status" = 'APPROVED' AND t."status" = 'PUBLISHED';
