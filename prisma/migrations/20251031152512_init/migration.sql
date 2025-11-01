-- CreateTable
CREATE TABLE "User" (
    "npub" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Entitlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "npub" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "originalTxId" TEXT,
    "purchaseToken" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "quotaBytes" BIGINT NOT NULL,
    "egressBytesMon" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Entitlement_npub_fkey" FOREIGN KEY ("npub") REFERENCES "User" ("npub") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Usage" (
    "npub" TEXT NOT NULL PRIMARY KEY,
    "storedBytes" BIGINT NOT NULL DEFAULT 0,
    "egressBytesMon" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Usage_npub_fkey" FOREIGN KEY ("npub") REFERENCES "User" ("npub") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "npub" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Upload_npub_fkey" FOREIGN KEY ("npub") REFERENCES "User" ("npub") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplePurchase" (
    "originalTxId" TEXT NOT NULL PRIMARY KEY,
    "npub" TEXT NOT NULL,
    "appAccountToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplePurchase_npub_fkey" FOREIGN KEY ("npub") REFERENCES "User" ("npub") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GooglePurchase" (
    "purchaseToken" TEXT NOT NULL PRIMARY KEY,
    "npub" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GooglePurchase_npub_fkey" FOREIGN KEY ("npub") REFERENCES "User" ("npub") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Entitlement_npub_platform_idx" ON "Entitlement"("npub", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "Entitlement_npub_productId_key" ON "Entitlement"("npub", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_objectKey_key" ON "Upload"("objectKey");

-- CreateIndex
CREATE INDEX "Upload_npub_idx" ON "Upload"("npub");
