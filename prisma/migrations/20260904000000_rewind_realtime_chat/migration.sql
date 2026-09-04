ALTER TABLE "User"
  ADD COLUMN "rewind_proactive_chat_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "rewind_proactive_chat_explained_at" TIMESTAMP(3);

CREATE TYPE "RewindChatRunTrigger" AS ENUM ('USER_MESSAGE', 'ACTIVITY_SIGNAL', 'PARTNER_FOLLOW_UP', 'PROACTIVE_TIMER');
CREATE TYPE "RewindChatRunStatus" AS ENUM ('QUEUED', 'PLANNING', 'GENERATING', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "RewindChatTurnStatus" AS ENUM ('PLANNED', 'GENERATING', 'COMPLETED', 'CANCELLED', 'FAILED');
CREATE TYPE "RewindPartnerMindState" AS ENUM ('DORMANT', 'WATCHING', 'READY', 'COOLDOWN');

ALTER TABLE "rewind_chats"
  ADD COLUMN "last_read_at" TIMESTAMP(3),
  ADD COLUMN "unread_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "proactive_muted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "context_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "rewind_chat_messages"
  ADD COLUMN "run_id" TEXT,
  ADD COLUMN "turn_id" TEXT,
  ADD COLUMN "reply_to_message_id" TEXT;

CREATE TABLE "rewind_partner_minds" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "persona_id" TEXT NOT NULL,
  "state" "RewindPartnerMindState" NOT NULL DEFAULT 'WATCHING',
  "intent_summary" VARCHAR(280),
  "evidence" JSONB,
  "confidence" DOUBLE PRECISION,
  "context_revision" INTEGER NOT NULL DEFAULT 0,
  "next_consider_at" TIMESTAMP(3),
  "cooldown_until" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "last_evaluated_at" TIMESTAMP(3),
  "last_spoke_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rewind_partner_minds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rewind_chat_runs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "trigger" "RewindChatRunTrigger" NOT NULL,
  "status" "RewindChatRunStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotency_key" TEXT NOT NULL,
  "source_message_id" TEXT,
  "context_revision" INTEGER NOT NULL,
  "max_turns" INTEGER NOT NULL DEFAULT 6,
  "turns_used" INTEGER NOT NULL DEFAULT 0,
  "lease_token" TEXT,
  "leased_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rewind_chat_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rewind_chat_turns" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "persona_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" "RewindChatTurnStatus" NOT NULL DEFAULT 'PLANNED',
  "reply_to_message_id" TEXT,
  "first_delta_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rewind_chat_turns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rewind_chat_outbox" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "chat_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "dedupe_key" TEXT NOT NULL,
  "published_at" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rewind_chat_outbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rewind_partner_minds_chat_id_persona_id_key" ON "rewind_partner_minds"("chat_id", "persona_id");
CREATE INDEX "rewind_partner_minds_user_id_next_consider_at_state_idx" ON "rewind_partner_minds"("user_id", "next_consider_at", "state");
CREATE UNIQUE INDEX "rewind_chat_runs_idempotency_key_key" ON "rewind_chat_runs"("idempotency_key");
CREATE INDEX "rewind_chat_runs_user_id_status_created_at_idx" ON "rewind_chat_runs"("user_id", "status", "created_at");
CREATE INDEX "rewind_chat_runs_chat_id_status_created_at_idx" ON "rewind_chat_runs"("chat_id", "status", "created_at");
CREATE UNIQUE INDEX "rewind_chat_turns_run_id_sequence_key" ON "rewind_chat_turns"("run_id", "sequence");
CREATE INDEX "rewind_chat_turns_chat_id_status_created_at_idx" ON "rewind_chat_turns"("chat_id", "status", "created_at");
CREATE UNIQUE INDEX "rewind_chat_outbox_dedupe_key_key" ON "rewind_chat_outbox"("dedupe_key");
CREATE INDEX "rewind_chat_outbox_published_at_created_at_idx" ON "rewind_chat_outbox"("published_at", "created_at");
CREATE INDEX "rewind_chat_outbox_user_id_created_at_idx" ON "rewind_chat_outbox"("user_id", "created_at");
CREATE INDEX "rewind_chat_messages_run_id_idx" ON "rewind_chat_messages"("run_id");
CREATE INDEX "rewind_chat_messages_turn_id_idx" ON "rewind_chat_messages"("turn_id");

ALTER TABLE "rewind_chat_messages"
  ADD CONSTRAINT "rewind_chat_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "rewind_chat_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_messages_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "rewind_chat_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_messages_reply_to_message_id_fkey" FOREIGN KEY ("reply_to_message_id") REFERENCES "rewind_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rewind_partner_minds"
  ADD CONSTRAINT "rewind_partner_minds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_partner_minds_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rewind_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_runs"
  ADD CONSTRAINT "rewind_chat_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_runs_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rewind_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_runs_source_message_id_fkey" FOREIGN KEY ("source_message_id") REFERENCES "rewind_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_turns"
  ADD CONSTRAINT "rewind_chat_turns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_turns_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rewind_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_turns_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "rewind_chat_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_outbox"
  ADD CONSTRAINT "rewind_chat_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "rewind_chat_outbox_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "rewind_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
