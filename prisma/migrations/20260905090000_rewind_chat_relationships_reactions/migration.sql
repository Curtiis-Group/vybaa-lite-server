CREATE TYPE "RewindChatReactionKind" AS ENUM ('LOVE', 'LAUGH', 'CRY', 'LIKE');
CREATE TYPE "RewindChatReactionActor" AS ENUM ('USER', 'PARTNER');

CREATE TABLE "rewind_partner_relationships" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "persona_id" TEXT NOT NULL,
  "love" INTEGER NOT NULL DEFAULT 15,
  "anger" INTEGER NOT NULL DEFAULT 0,
  "hate" INTEGER NOT NULL DEFAULT 0,
  "jealousy" INTEGER NOT NULL DEFAULT 0,
  "malice" INTEGER NOT NULL DEFAULT 0,
  "memory_summary" VARCHAR(320),
  "last_interaction_at" TIMESTAMP(3),
  "last_decay_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rewind_partner_relationships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rewind_partner_relationships_emotion_bounds" CHECK (
    "love" BETWEEN 0 AND 100 AND
    "anger" BETWEEN 0 AND 100 AND
    "hate" BETWEEN 0 AND 100 AND
    "jealousy" BETWEEN 0 AND 100 AND
    "malice" BETWEEN 0 AND 100
  )
);

CREATE UNIQUE INDEX "rewind_partner_relationships_user_id_persona_id_key"
  ON "rewind_partner_relationships"("user_id", "persona_id");
CREATE INDEX "rewind_partner_relationships_user_id_updated_at_idx"
  ON "rewind_partner_relationships"("user_id", "updated_at");

CREATE TABLE "rewind_chat_reactions" (
  "id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "actor_key" TEXT NOT NULL,
  "actor" "RewindChatReactionActor" NOT NULL,
  "persona_id" TEXT,
  "kind" "RewindChatReactionKind" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rewind_chat_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rewind_chat_reactions_message_id_actor_key_key"
  ON "rewind_chat_reactions"("message_id", "actor_key");
CREATE INDEX "rewind_chat_reactions_user_id_created_at_idx"
  ON "rewind_chat_reactions"("user_id", "created_at");

ALTER TABLE "rewind_partner_relationships"
  ADD CONSTRAINT "rewind_partner_relationships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_reactions"
  ADD CONSTRAINT "rewind_chat_reactions_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "rewind_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rewind_chat_reactions"
  ADD CONSTRAINT "rewind_chat_reactions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
