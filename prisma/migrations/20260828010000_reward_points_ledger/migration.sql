-- Idempotent ledger entries for Play Points awards and releases.
CREATE UNIQUE INDEX "transactions_dedupe_key_key"
ON "transactions"("dedupe_key");
