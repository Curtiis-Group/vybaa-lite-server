ALTER TABLE "rewind_chats" ADD COLUMN "conversation_mood" JSONB;
ALTER TABLE "rewind_chat_messages"
  ADD COLUMN "read_schedule" JSONB,
  ADD COLUMN "read_due_at" TIMESTAMP(3);
CREATE INDEX "rewind_chat_messages_seen_at_read_due_at_idx"
  ON "rewind_chat_messages"("seen_at", "read_due_at");
