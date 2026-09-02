CREATE TYPE "RewindRecommendationType" AS ENUM ('GOAL_PROGRESS', 'NEW_GOAL', 'FLEXX');
CREATE TYPE "RewindRecommendationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DISMISSED', 'EXPIRED');

CREATE TABLE "rewind_recommendations" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "RewindRecommendationType" NOT NULL,
    "status" "RewindRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "resulting_goal_id" TEXT,
    "resulting_progress_entry_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rewind_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rewind_recommendations_dedupe_key_key" ON "rewind_recommendations"("dedupe_key");
CREATE UNIQUE INDEX "rewind_recommendations_resulting_goal_id_key" ON "rewind_recommendations"("resulting_goal_id");
CREATE UNIQUE INDEX "rewind_recommendations_resulting_progress_entry_id_key" ON "rewind_recommendations"("resulting_progress_entry_id");
CREATE INDEX "rewind_recommendations_session_id_status_idx" ON "rewind_recommendations"("session_id", "status");
CREATE INDEX "rewind_recommendations_user_id_created_at_idx" ON "rewind_recommendations"("user_id", "created_at");

ALTER TABLE "rewind_recommendations" ADD CONSTRAINT "rewind_recommendations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "rewind_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rewind_recommendations" ADD CONSTRAINT "rewind_recommendations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rewind_recommendations" ADD CONSTRAINT "rewind_recommendations_resulting_goal_id_fkey" FOREIGN KEY ("resulting_goal_id") REFERENCES "goals_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rewind_recommendations" ADD CONSTRAINT "rewind_recommendations_resulting_progress_entry_id_fkey" FOREIGN KEY ("resulting_progress_entry_id") REFERENCES "goal_progress_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
