ALTER TABLE "social_preferences"
  ADD COLUMN "activity_suggestion_consent_at" TIMESTAMP(3),
  ADD COLUMN "last_inferred_suggestion_at" TIMESTAMP(3);

ALTER TABLE "social_drafts"
  ADD COLUMN "suggestion_key" TEXT,
  ADD COLUMN "source_label" TEXT,
  ADD COLUMN "source_reason" TEXT;

CREATE UNIQUE INDEX "social_drafts_suggestion_key_key"
  ON "social_drafts"("suggestion_key");
