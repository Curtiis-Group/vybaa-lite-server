CREATE TYPE "RewindFrequency" AS ENUM (
  'MORNINGS_AND_EVENINGS',
  'JUST_MORNINGS',
  'JUST_EVENINGS',
  'CUSTOM'
);

CREATE TYPE "RewindIntent" AS ENUM (
  'UNDERSTAND_EMOTIONS',
  'SPOT_PATTERNS',
  'BUILD_SMALL_CHANGES',
  'CUSTOM'
);

CREATE TYPE "RewindSessionStatus" AS ENUM (
  'LEGACY',
  'SCHEDULED',
  'IN_PROGRESS',
  'FINALIZING',
  'COMPLETED',
  'MISSED'
);

CREATE TYPE "RewindCompletionSource" AS ENUM ('USER', 'AUTO_TIMEOUT');

ALTER TABLE "users"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';

CREATE TABLE "rewind_routines" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "frequency" "RewindFrequency" NOT NULL,
  "times" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "intent" "RewindIntent" NOT NULL,
  "custom_intent" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rewind_routines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rewind_routines_user_id_key" ON "rewind_routines"("user_id");

ALTER TABLE "rewind_routines"
  ADD CONSTRAINT "rewind_routines_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_sessions"
  ADD COLUMN "scheduled_for" TIMESTAMP(3),
  ADD COLUMN "window_ends_at" TIMESTAMP(3),
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "status" "RewindSessionStatus" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "completion_source" "RewindCompletionSource";

DROP INDEX IF EXISTS "rewind_sessions_user_id_persona_id_session_date_key_key";

CREATE UNIQUE INDEX "rewind_sessions_user_id_scheduled_for_key"
  ON "rewind_sessions"("user_id", "scheduled_for");

CREATE INDEX "rewind_sessions_status_window_ends_at_idx"
  ON "rewind_sessions"("status", "window_ends_at");
