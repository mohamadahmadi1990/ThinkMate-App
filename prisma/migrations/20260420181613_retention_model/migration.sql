-- CreateTable
CREATE TABLE "EphemeralInput" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EphemeralInput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL,
    "representativeText" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "matchType" TEXT NOT NULL,
    "matchCount" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "averageSimilarity" DOUBLE PRECISION,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EphemeralInput_createdAt_idx" ON "EphemeralInput"("createdAt");

-- CreateIndex
CREATE INDEX "EphemeralInput_expiresAt_idx" ON "EphemeralInput"("expiresAt");

-- CreateIndex
CREATE INDEX "EphemeralInput_text_expiresAt_idx" ON "EphemeralInput"("text", "expiresAt");

-- CreateIndex
CREATE INDEX "MatchEvent_lastSeenAt_idx" ON "MatchEvent"("lastSeenAt");

-- CreateIndex
CREATE INDEX "MatchEvent_matchType_representativeText_lastSeenAt_idx" ON "MatchEvent"("matchType", "representativeText", "lastSeenAt");
