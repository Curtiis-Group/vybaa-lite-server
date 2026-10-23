ALTER TABLE "goals_v2" ADD COLUMN "rewind_session_id" TEXT;
CREATE UNIQUE INDEX "goals_v2_rewind_session_id_key" ON "goals_v2"("rewind_session_id");
ALTER TABLE "goals_v2" ADD CONSTRAINT "goals_v2_rewind_session_id_fkey"
  FOREIGN KEY ("rewind_session_id") REFERENCES "rewind_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
