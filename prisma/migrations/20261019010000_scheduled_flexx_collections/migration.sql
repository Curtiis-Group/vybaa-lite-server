CREATE TABLE "flexx_design_collections" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "model" TEXT NOT NULL,
    "designs" JSONB,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flexx_design_collections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "flexx_design_collections_status_check" CHECK ("status" IN ('GENERATING', 'READY', 'FAILED'))
);

CREATE INDEX "flexx_design_collections_status_published_at_id_idx"
ON "flexx_design_collections"("status", "published_at", "id");
