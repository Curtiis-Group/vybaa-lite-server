CREATE INDEX "transactions_recipient_created_id_idx"
ON "transactions"("recipient_id", "created_at" DESC, "id" DESC);

CREATE INDEX "transactions_sender_created_id_idx"
ON "transactions"("sender_id", "created_at" DESC, "id" DESC);
