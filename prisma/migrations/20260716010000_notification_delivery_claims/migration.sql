ALTER TABLE "notifications"
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "dispatch_token" TEXT,
  ADD COLUMN "dispatching_at" TIMESTAMP(3),
  ADD COLUMN "delivery_attempts" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key"
  ON "notifications"("user_id", "dedupe_key");

CREATE INDEX "notifications_dispatch_token_idx"
  ON "notifications"("dispatch_token");

CREATE INDEX "notifications_sent_at_scheduled_for_dispatching_at_idx"
  ON "notifications"("sent_at", "scheduled_for", "dispatching_at");
