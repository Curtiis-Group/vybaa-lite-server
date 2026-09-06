ALTER TYPE "AiUsageOperation" ADD VALUE IF NOT EXISTS 'REWIND_CONTEXT_COMPACTION';

ALTER TABLE "rewind_chats"
  ADD COLUMN "context_summary" TEXT,
  ADD COLUMN "context_summary_through_message_id" TEXT,
  ADD COLUMN "context_summary_updated_at" TIMESTAMP(3);
