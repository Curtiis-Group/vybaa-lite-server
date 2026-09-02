CREATE TYPE "GoalV2Status" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ABANDONED', 'AUTO_ABANDONED');
CREATE TYPE "GoalTargetType" AS ENUM ('CHECK_IN_COUNT', 'QUANTITY', 'UNTIL_DATE');
CREATE TYPE "GoalScheduleType" AS ENUM ('ONE_TIME', 'DAILY', 'WEEKLY', 'SELECTED_WEEKDAYS');
CREATE TYPE "GoalMissMode" AS ENUM ('STRICT', 'FLEXIBLE', 'NO_STREAK');
CREATE TYPE "GoalRewardReleasePolicy" AS ENUM ('IMMEDIATE', 'ON_COMPLETION');
CREATE TYPE "GoalOccurrenceStatus" AS ENUM ('PENDING', 'GRACE', 'COMPLETED', 'MISSED', 'CANCELLED');
CREATE TYPE "GoalRewardPlanSource" AS ENUM ('STANDARD', 'COMMUNITY_TEMPLATE');
CREATE TYPE "GoalRewardAwardStatus" AS ENUM ('PENDING', 'RELEASED', 'FORFEITED');
CREATE TYPE "GoalResumeDeadlinePolicy" AS ENUM ('KEEP_DEADLINE', 'SHIFT_DEADLINE');

ALTER TABLE "Goal" ADD COLUMN "archived_at" TIMESTAMP(3);

ALTER TABLE "goal_templates"
  ADD COLUMN "model_version" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "target_type" "GoalTargetType" NOT NULL DEFAULT 'CHECK_IN_COUNT',
  ADD COLUMN "target_value" DOUBLE PRECISION,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "schedule_type" "GoalScheduleType" NOT NULL DEFAULT 'DAILY',
  ADD COLUMN "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN "reminder_times" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "goal_templates"
SET
  "target_value" = "target_days"::DOUBLE PRECISION,
  "reminder_times" = CASE
    WHEN "reminder_time" IS NULL THEN ARRAY[]::TEXT[]
    ELSE ARRAY["reminder_time"]::TEXT[]
  END;

WITH template_totals AS (
  SELECT "template_id", SUM("points") AS total
  FROM "template_milestones"
  GROUP BY "template_id"
)
UPDATE "template_milestones" AS milestone
SET
  "points" = milestone."points" * (2.85 / totals.total),
  "sequence_bonus_points" = milestone."sequence_bonus_points" * (2.85 / totals.total)
FROM template_totals AS totals
WHERE milestone."template_id" = totals."template_id" AND totals.total > 2.85;

CREATE TABLE "goals_v2" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "GoalV2Status" NOT NULL DEFAULT 'ACTIVE',
    "target_type" "GoalTargetType" NOT NULL,
    "target_value" DOUBLE PRECISION,
    "unit" TEXT,
    "schedule_type" "GoalScheduleType" NOT NULL,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "hard_stop_date" DATE NOT NULL,
    "reminder_times" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "miss_mode" "GoalMissMode" NOT NULL DEFAULT 'STRICT',
    "grace_hours" INTEGER NOT NULL DEFAULT 0,
    "break_streak_on_miss" BOOLEAN NOT NULL DEFAULT true,
    "forfeit_pending_on_miss" BOOLEAN NOT NULL DEFAULT true,
    "max_consecutive_misses" INTEGER,
    "reward_release_policy" "GoalRewardReleasePolicy" NOT NULL DEFAULT 'ON_COMPLETION',
    "progress_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completed_occurrences" INTEGER NOT NULL DEFAULT 0,
    "missed_occurrences" INTEGER NOT NULL DEFAULT 0,
    "current_streak" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "consecutive_misses" INTEGER NOT NULL DEFAULT 0,
    "community_id" TEXT,
    "template_id" TEXT,
    "reopened_from_id" TEXT,
    "paused_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "abandoned_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goals_v2_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_occurrences" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "status" "GoalOccurrenceStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" DATE NOT NULL,
    "original_due_date" DATE NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "grace_ends_at" TIMESTAMP(3),
    "rescheduled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_occurrences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_progress_entries" (
    "id" TEXT NOT NULL,
    "occurrence_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "notes" TEXT,
    "attachments" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_progress_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_reward_plans" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "source" "GoalRewardPlanSource" NOT NULL,
    "release_policy" "GoalRewardReleasePolicy" NOT NULL,
    "eligible" BOOLEAN NOT NULL DEFAULT false,
    "eligible_at" TIMESTAMP(3),
    "total_potential" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goal_reward_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_reward_milestones" (
    "id" TEXT NOT NULL,
    "reward_plan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger_percentage" INTEGER NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "goal_reward_milestones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_reward_awards" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "plan_id" TEXT,
    "milestone_id" TEXT,
    "reference_title" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL DEFAULT 'GOAL_V2',
    "points" DOUBLE PRECISION NOT NULL,
    "status" "GoalRewardAwardStatus" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "transaction_id" TEXT,
    "awarded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),
    "forfeited_at" TIMESTAMP(3),
    CONSTRAINT "goal_reward_awards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_conclusions" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "outcome" "GoalV2Status" NOT NULL,
    "final_progress" DOUBLE PRECISION NOT NULL,
    "target_value" DOUBLE PRECISION,
    "adherence_rate" DOUBLE PRECISION NOT NULL,
    "completed_occurrences" INTEGER NOT NULL,
    "missed_occurrences" INTEGER NOT NULL,
    "current_streak" INTEGER NOT NULL,
    "longest_streak" INTEGER NOT NULL,
    "duration_days" INTEGER NOT NULL,
    "over_target_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "earned_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "released_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "forfeited_points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rating" INTEGER,
    "reflection" TEXT,
    "next_step" TEXT,
    "attachments" JSONB,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_updated_at" TIMESTAMP(3),
    CONSTRAINT "goal_conclusions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goal_pauses" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "paused_at" TIMESTAMP(3) NOT NULL,
    "resumed_at" TIMESTAMP(3),
    "deadline_policy" "GoalResumeDeadlinePolicy",
    CONSTRAINT "goal_pauses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "goals_v2_user_id_status_archived_at_idx" ON "goals_v2"("user_id", "status", "archived_at");
CREATE INDEX "goals_v2_status_hard_stop_date_idx" ON "goals_v2"("status", "hard_stop_date");
CREATE INDEX "goals_v2_community_id_idx" ON "goals_v2"("community_id");
CREATE INDEX "goals_v2_template_id_idx" ON "goals_v2"("template_id");
CREATE INDEX "goal_occurrences_status_closes_at_idx" ON "goal_occurrences"("status", "closes_at");
CREATE INDEX "goal_occurrences_goal_id_due_date_idx" ON "goal_occurrences"("goal_id", "due_date");
CREATE UNIQUE INDEX "goal_occurrences_goal_id_due_date_key" ON "goal_occurrences"("goal_id", "due_date");
CREATE UNIQUE INDEX "goal_progress_entries_occurrence_id_key" ON "goal_progress_entries"("occurrence_id");
CREATE UNIQUE INDEX "goal_reward_plans_goal_id_key" ON "goal_reward_plans"("goal_id");
CREATE INDEX "goal_reward_milestones_reward_plan_id_order_idx" ON "goal_reward_milestones"("reward_plan_id", "order");
CREATE UNIQUE INDEX "goal_reward_milestones_reward_plan_id_trigger_percentage_key" ON "goal_reward_milestones"("reward_plan_id", "trigger_percentage");
CREATE UNIQUE INDEX "goal_reward_awards_dedupe_key_key" ON "goal_reward_awards"("dedupe_key");
CREATE INDEX "goal_reward_awards_goal_id_status_idx" ON "goal_reward_awards"("goal_id", "status");
CREATE UNIQUE INDEX "goal_reward_awards_goal_id_milestone_id_key" ON "goal_reward_awards"("goal_id", "milestone_id");
CREATE UNIQUE INDEX "goal_conclusions_goal_id_key" ON "goal_conclusions"("goal_id");
CREATE INDEX "goal_pauses_goal_id_paused_at_idx" ON "goal_pauses"("goal_id", "paused_at");

ALTER TABLE "goals_v2" ADD CONSTRAINT "goals_v2_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goals_v2" ADD CONSTRAINT "goals_v2_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goals_v2" ADD CONSTRAINT "goals_v2_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "goal_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goals_v2" ADD CONSTRAINT "goals_v2_reopened_from_id_fkey" FOREIGN KEY ("reopened_from_id") REFERENCES "goals_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goal_occurrences" ADD CONSTRAINT "goal_occurrences_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_progress_entries" ADD CONSTRAINT "goal_progress_entries_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "goal_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_reward_plans" ADD CONSTRAINT "goal_reward_plans_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_reward_milestones" ADD CONSTRAINT "goal_reward_milestones_reward_plan_id_fkey" FOREIGN KEY ("reward_plan_id") REFERENCES "goal_reward_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_reward_awards" ADD CONSTRAINT "goal_reward_awards_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "goal_reward_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goal_reward_awards" ADD CONSTRAINT "goal_reward_awards_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "goal_reward_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "goal_conclusions" ADD CONSTRAINT "goal_conclusions_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_pauses" ADD CONSTRAINT "goal_pauses_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE;
