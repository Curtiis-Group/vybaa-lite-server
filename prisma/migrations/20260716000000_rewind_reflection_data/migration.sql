CREATE TYPE "RewindTurnRole" AS ENUM ('USER', 'PARTNER');

ALTER TABLE "rewind_sessions"
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "comparison_insight" TEXT,
  ADD COLUMN "journal_draft" TEXT,
  ADD COLUMN "wellbeing_signals" JSONB,
  ADD COLUMN "transcript_available" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "journal_id" TEXT,
  ADD COLUMN "journal_saved_at" TIMESTAMP(3);

CREATE TABLE "rewind_turns" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" "RewindTurnRole" NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rewind_turns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rewind_turns_session_id_sequence_key"
  ON "rewind_turns"("session_id", "sequence");
CREATE INDEX "rewind_turns_session_id_created_at_idx"
  ON "rewind_turns"("session_id", "created_at");
CREATE INDEX "rewind_sessions_user_id_completed_session_date_key_idx"
  ON "rewind_sessions"("user_id", "completed", "session_date_key");
CREATE INDEX "rewind_sessions_journal_id_idx"
  ON "rewind_sessions"("journal_id");

ALTER TABLE "rewind_sessions"
  ADD CONSTRAINT "rewind_sessions_journal_id_fkey"
  FOREIGN KEY ("journal_id") REFERENCES "journals"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
