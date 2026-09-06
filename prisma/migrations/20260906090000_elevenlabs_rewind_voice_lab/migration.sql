CREATE TYPE "RewindVoiceProvider" AS ENUM ('GEMINI', 'ELEVENLABS');

ALTER TABLE "rewind_sessions"
ADD COLUMN "voice_provider" "RewindVoiceProvider" NOT NULL DEFAULT 'GEMINI',
ADD COLUMN "is_test_session" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "rewind_sessions_user_id_is_test_session_updated_at_idx"
ON "rewind_sessions"("user_id", "is_test_session", "updated_at");
