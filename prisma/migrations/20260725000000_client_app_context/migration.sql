CREATE TYPE "ClientApp" AS ENUM ('VYBAA', 'MYCOVE');

CREATE TABLE "fcm_devices" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "client_app" "ClientApp" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fcm_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "fcm_devices_client_app_token_key"
  ON "fcm_devices"("client_app", "token");
CREATE INDEX "fcm_devices_user_id_client_app_idx"
  ON "fcm_devices"("user_id", "client_app");

ALTER TABLE "fcm_devices"
  ADD CONSTRAINT "fcm_devices_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
