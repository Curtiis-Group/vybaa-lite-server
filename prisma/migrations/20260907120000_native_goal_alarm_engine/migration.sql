ALTER TABLE "fcm_devices"
  ADD COLUMN "goal_alarms_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "goal_alarm_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "goal_alarms_synced_at" TIMESTAMP(3);
