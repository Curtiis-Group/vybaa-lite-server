ALTER TABLE "User" ADD COLUMN "apple_id" TEXT;

CREATE UNIQUE INDEX "User_apple_id_key" ON "User"("apple_id");
