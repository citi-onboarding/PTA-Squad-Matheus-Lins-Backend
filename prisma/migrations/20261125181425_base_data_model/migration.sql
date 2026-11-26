-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SELLER', 'MANAGER', 'FINANCE', 'ADMIN');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('PAID', 'OPEN', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ReceivableSource" AS ENUM ('ERP', 'SPREADSHEET');

-- CreateEnum
CREATE TYPE "SyncRunType" AS ENUM ('ERP_SYNC', 'HISTORY_LOAD');

-- CreateEnum
CREATE TYPE "SyncRunResult" AS ENUM ('RUNNING', 'SUCCESS', 'FAILURE');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "sellerCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "creditLimitCents" INTEGER NOT NULL,
    "sellerCode" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "status" "CustomerStatus" NOT NULL,
    "erpUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "listPriceCents" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL,
    "erpUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receivable" (
    "id" SERIAL NOT NULL,
    "number" INTEGER NOT NULL,
    "customerCode" TEXT NOT NULL,
    "erpOrderNumber" INTEGER,
    "installment" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "status" "ReceivableStatus" NOT NULL,
    "source" "ReceivableSource" NOT NULL DEFAULT 'ERP',
    "erpUpdatedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" SERIAL NOT NULL,
    "type" "SyncRunType" NOT NULL,
    "entity" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "result" "SyncRunResult" NOT NULL DEFAULT 'RUNNING',
    "itemsRead" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");

-- CreateIndex
CREATE INDEX "Customer_sellerCode_idx" ON "Customer"("sellerCode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Receivable_number_key" ON "Receivable"("number");

-- CreateIndex
CREATE INDEX "Receivable_customerCode_idx" ON "Receivable"("customerCode");

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_customerCode_fkey" FOREIGN KEY ("customerCode") REFERENCES "Customer"("code") ON DELETE RESTRICT ON UPDATE CASCADE;
