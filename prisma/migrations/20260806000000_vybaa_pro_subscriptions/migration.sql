CREATE TABLE "subscription_snapshots" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "client_app" "ClientApp" NOT NULL,
  "entitlement_id" TEXT NOT NULL,
  "is_pro" BOOLEAN NOT NULL DEFAULT false,
  "product_identifier" TEXT,
  "period_type" TEXT,
  "environment" TEXT,
  "expires_at" TIMESTAMP(3),
  "management_url" TEXT,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subscription_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_snapshots_user_id_client_app_key"
  ON "subscription_snapshots"("user_id", "client_app");
CREATE INDEX "subscription_snapshots_client_app_is_pro_expires_at_idx"
  ON "subscription_snapshots"("client_app", "is_pro", "expires_at");

ALTER TABLE "subscription_snapshots"
  ADD CONSTRAINT "subscription_snapshots_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
