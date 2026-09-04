ALTER TABLE "User"
ADD COLUMN "rewind_personalization_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "RewindChatType" AS ENUM ('GROUP', 'PARTNER');
CREATE TYPE "RewindChatMessageRole" AS ENUM ('USER', 'PARTNER', 'SYSTEM');
CREATE TYPE "ActivitySignalSourceType" AS ENUM (
    'ACHIEVEMENT',
    'FLEXX',
    'GOAL',
    'JOURNAL',
    'REWARD',
    'REWIND_CHAT',
    'REWIND_ROUTINE',
    'REWIND_VOICE'
);

CREATE TABLE "rewind_chats" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "thread_key" TEXT NOT NULL,
    "type" "RewindChatType" NOT NULL,
    "persona_id" TEXT,
    "title" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rewind_chats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rewind_chat_messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "RewindChatMessageRole" NOT NULL,
    "persona_id" TEXT,
    "content" TEXT NOT NULL,
    "local_date_key" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "rewind_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "activity_signals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "source_type" "ActivitySignalSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "local_date_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "persona_id" TEXT,
    "metadata" JSONB,
    "privacy_eligible" BOOLEAN NOT NULL DEFAULT true,
    "dedupe_key" TEXT NOT NULL,
    "happened_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_signals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_observations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "local_date_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "observations" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "source_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "persona_id" TEXT,
    "home_greeting" TEXT,
    "reflection" TEXT,
    "journal_draft" TEXT,
    "generation_version" INTEGER NOT NULL DEFAULT 1,
    "dismissed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_observations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rewind_chats_user_id_thread_key_key"
ON "rewind_chats"("user_id", "thread_key");
CREATE INDEX "rewind_chats_user_id_archived_at_last_message_at_idx"
ON "rewind_chats"("user_id", "archived_at", "last_message_at");

CREATE UNIQUE INDEX "rewind_chat_messages_idempotency_key_key"
ON "rewind_chat_messages"("idempotency_key");
CREATE INDEX "rewind_chat_messages_chat_id_created_at_id_idx"
ON "rewind_chat_messages"("chat_id", "created_at", "id");
CREATE INDEX "rewind_chat_messages_user_id_local_date_key_created_at_idx"
ON "rewind_chat_messages"("user_id", "local_date_key", "created_at");

CREATE UNIQUE INDEX "activity_signals_dedupe_key_key"
ON "activity_signals"("dedupe_key");
CREATE INDEX "activity_signals_user_id_local_date_key_happened_at_idx"
ON "activity_signals"("user_id", "local_date_key", "happened_at");
CREATE INDEX "activity_signals_user_id_source_type_happened_at_idx"
ON "activity_signals"("user_id", "source_type", "happened_at");

CREATE UNIQUE INDEX "daily_observations_user_id_local_date_key_key"
ON "daily_observations"("user_id", "local_date_key");
CREATE INDEX "daily_observations_user_id_dismissed_at_local_date_key_idx"
ON "daily_observations"("user_id", "dismissed_at", "local_date_key");

ALTER TABLE "rewind_chats"
ADD CONSTRAINT "rewind_chats_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_messages"
ADD CONSTRAINT "rewind_chat_messages_chat_id_fkey"
FOREIGN KEY ("chat_id") REFERENCES "rewind_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_messages"
ADD CONSTRAINT "rewind_chat_messages_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_signals"
ADD CONSTRAINT "activity_signals_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_observations"
ADD CONSTRAINT "daily_observations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
