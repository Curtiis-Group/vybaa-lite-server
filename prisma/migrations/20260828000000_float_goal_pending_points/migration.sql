-- Play Point awards can be fractional, including for personal goal streak milestones.
ALTER TABLE "goal_pending_points"
ALTER COLUMN "total_pending_points" TYPE DOUBLE PRECISION
USING "total_pending_points"::DOUBLE PRECISION;
