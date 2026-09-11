ALTER TABLE "User"
ADD COLUMN "suspended_at" TIMESTAMP(3),
ADD COLUMN "terms_accepted_at" TIMESTAMP(3),
ADD COLUMN "terms_version" TEXT;

ALTER TABLE "content_reports"
ADD COLUMN "evidence_snapshot" TEXT,
ADD COLUMN "moderator_action" TEXT,
ADD COLUMN "moderator_note" TEXT,
ADD COLUMN "reviewed_at" TIMESTAMP(3);

ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_activity_id_fkey";
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_comment_id_fkey";
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "community_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "activity_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "content_reports_created_at_status_idx" ON "content_reports"("created_at", "status");
