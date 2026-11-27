-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN     "cursorAt" TIMESTAMP(3),
ADD COLUMN     "itemsRejected" INTEGER NOT NULL DEFAULT 0;
