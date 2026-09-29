-- CreateEnum
CREATE TYPE "StockImportStatus" AS ENUM ('DRAFT', 'ACTIVE');

-- CreateTable
CREATE TABLE "StockImport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'telegram',
    "status" "StockImportStatus" NOT NULL DEFAULT 'DRAFT',
    "rowCount" INTEGER NOT NULL,
    "totalQuantity" DECIMAL(18,3) NOT NULL,
    "totalValue" DECIMAL(18,2),
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "StockImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockImportItem" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "storageName" TEXT,
    "quantity" DECIMAL(18,3) NOT NULL,
    "unit" TEXT,
    "cost" DECIMAL(18,2),
    "value" DECIMAL(18,2),

    CONSTRAINT "StockImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockImport_companyId_status_createdAt_idx" ON "StockImport"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "StockImportItem_importId_idx" ON "StockImportItem"("importId");

-- AddForeignKey
ALTER TABLE "StockImport" ADD CONSTRAINT "StockImport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockImportItem" ADD CONSTRAINT "StockImportItem_importId_fkey" FOREIGN KEY ("importId") REFERENCES "StockImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
