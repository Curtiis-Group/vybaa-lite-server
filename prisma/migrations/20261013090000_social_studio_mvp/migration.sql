ALTER TYPE "AiUsageOperation" ADD VALUE 'SOCIAL_CONTENT_DRAFT';

CREATE TYPE "SocialScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "SocialDraftType" AS ENUM ('POST', 'THREAD', 'REPLY');
CREATE TYPE "SocialDraftStatus" AS ENUM (
  'DRAFT',
  'PUBLISHING',
  'PUBLISHED',
  'PARTIALLY_PUBLISHED',
  'PUBLISH_FAILED',
  'DISCARDED'
);

CREATE TABLE "social_accounts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "x_user_id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "profile_image_url" TEXT,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_mention_id" TEXT,
  "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_accounts_user_id_key" ON "social_accounts"("user_id");
CREATE UNIQUE INDEX "social_accounts_x_user_id_key" ON "social_accounts"("x_user_id");
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_preferences" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tone" TEXT,
  "voice_notes" TEXT,
  "audience" TEXT,
  "topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "avoid_topics" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "ai_drafting_consent_at" TIMESTAMP(3),
  "schedule_enabled" BOOLEAN NOT NULL DEFAULT false,
  "schedule_frequency" "SocialScheduleFrequency" NOT NULL DEFAULT 'WEEKLY',
  "schedule_time" TEXT NOT NULL DEFAULT '09:00',
  "schedule_day_of_week" INTEGER NOT NULL DEFAULT 1,
  "schedule_timezone" TEXT NOT NULL DEFAULT 'UTC',
  "next_suggestion_at" TIMESTAMP(3),
  "last_suggestion_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_preferences_user_id_key" ON "social_preferences"("user_id");
CREATE INDEX "social_preferences_schedule_enabled_next_suggestion_at_idx"
  ON "social_preferences"("schedule_enabled", "next_suggestion_at");
ALTER TABLE "social_preferences" ADD CONSTRAINT "social_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_oauth_states" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "state_hash" TEXT NOT NULL,
  "code_verifier_encrypted" TEXT NOT NULL,
  "return_url" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_oauth_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_oauth_states_state_hash_key" ON "social_oauth_states"("state_hash");
CREATE INDEX "social_oauth_states_expires_at_idx" ON "social_oauth_states"("expires_at");
CREATE INDEX "social_oauth_states_user_id_created_at_idx" ON "social_oauth_states"("user_id", "created_at");
ALTER TABLE "social_oauth_states" ADD CONSTRAINT "social_oauth_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_mentions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "x_tweet_id" TEXT NOT NULL,
  "author_x_user_id" TEXT,
  "author_username" TEXT NOT NULL,
  "author_display_name" TEXT,
  "text" TEXT NOT NULL,
  "referenced_tweet_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "posted_at" TIMESTAMP(3) NOT NULL,
  "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "social_mentions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "social_mentions_user_id_x_tweet_id_key"
  ON "social_mentions"("user_id", "x_tweet_id");
CREATE INDEX "social_mentions_user_id_posted_at_idx"
  ON "social_mentions"("user_id", "posted_at");
ALTER TABLE "social_mentions" ADD CONSTRAINT "social_mentions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "social_drafts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "source_mention_id" TEXT,
  "type" "SocialDraftType" NOT NULL,
  "status" "SocialDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "segments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "published_tweet_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "social_drafts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "social_drafts_user_id_status_created_at_idx"
  ON "social_drafts"("user_id", "status", "created_at");
CREATE INDEX "social_drafts_source_mention_id_idx" ON "social_drafts"("source_mention_id");
ALTER TABLE "social_drafts" ADD CONSTRAINT "social_drafts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_drafts" ADD CONSTRAINT "social_drafts_source_mention_id_fkey"
  FOREIGN KEY ("source_mention_id") REFERENCES "social_mentions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
