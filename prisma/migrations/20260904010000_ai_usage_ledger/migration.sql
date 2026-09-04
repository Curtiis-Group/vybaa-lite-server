CREATE TYPE "AiUsageOperation" AS ENUM ('REWIND_DIRECTOR', 'REWIND_PARTNER_TURN');

CREATE TABLE "ai_usage_ledger" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "run_id" TEXT,
  "turn_id" TEXT,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "operation" "AiUsageOperation" NOT NULL,
  "input_tokens" INTEGER NOT NULL DEFAULT 0,
  "output_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "input_rate_usd_per_million" DOUBLE PRECISION NOT NULL,
  "output_rate_usd_per_million" DOUBLE PRECISION NOT NULL,
  "estimated_cost_usd" DOUBLE PRECISION NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_usage_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_usage_ledger_idempotency_key_key" ON "ai_usage_ledger"("idempotency_key");
CREATE INDEX "ai_usage_ledger_user_id_created_at_idx" ON "ai_usage_ledger"("user_id", "created_at");
CREATE INDEX "ai_usage_ledger_run_id_created_at_idx" ON "ai_usage_ledger"("run_id", "created_at");
CREATE INDEX "ai_usage_ledger_operation_created_at_idx" ON "ai_usage_ledger"("operation", "created_at");

ALTER TABLE "ai_usage_ledger"
  ADD CONSTRAINT "ai_usage_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_usage_ledger_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "rewind_chat_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_usage_ledger_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "rewind_chat_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
