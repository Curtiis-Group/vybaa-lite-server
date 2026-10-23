-- Remove only the tasks created by the scheduled-Rewind integration.
-- User-authored tasks and Rewind sessions/history are preserved.
BEGIN;
DELETE FROM "goals_v2"
WHERE "rewind_session_id" IS NOT NULL
  AND "id" = 'rewind-task:' || "rewind_session_id";
ALTER TABLE "goals_v2" DROP COLUMN "rewind_session_id";
COMMIT;
