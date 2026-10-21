ALTER TABLE "daily_observations"
ADD COLUMN "task_suggestions" JSONB NOT NULL DEFAULT '[]';
