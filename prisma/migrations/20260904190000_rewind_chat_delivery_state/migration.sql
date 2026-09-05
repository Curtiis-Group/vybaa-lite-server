ALTER TABLE "rewind_chat_messages"
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "seen_at" TIMESTAMP(3);

UPDATE "rewind_chat_messages"
SET "delivered_at" = "created_at"
WHERE "role" = 'USER';
