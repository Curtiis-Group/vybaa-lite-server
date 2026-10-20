CREATE TABLE "goal_subtasks" (
  "id" TEXT NOT NULL,
  "goal_id" TEXT NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "completed_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goal_subtasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goal_subtasks_goal_id_fkey" FOREIGN KEY ("goal_id")
    REFERENCES "goals_v2"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "goal_subtasks_title_not_blank" CHECK (length(btrim("title")) > 0),
  CONSTRAINT "goal_subtasks_revision_nonnegative" CHECK ("revision" >= 0)
);
CREATE INDEX "goal_subtasks_goal_id_deleted_at_created_at_id_idx"
  ON "goal_subtasks"("goal_id", "deleted_at", "created_at", "id");
