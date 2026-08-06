CREATE TYPE "RevenueCatWebhookStatus" AS ENUM (
  'RECEIVED',
  'PROCESSING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE "revenuecat_webhook_events" (
  "id" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "client_app" "ClientApp" NOT NULL,
  "event_type" TEXT NOT NULL,
  "app_user_id" TEXT,
  "raw_payload" TEXT NOT NULL,
  "status" "RevenueCatWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "revenuecat_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "revenuecat_webhook_events_client_app_external_event_id_key"
  ON "revenuecat_webhook_events"("client_app", "external_event_id");
CREATE INDEX "revenuecat_webhook_events_status_next_attempt_at_idx"
  ON "revenuecat_webhook_events"("status", "next_attempt_at");
