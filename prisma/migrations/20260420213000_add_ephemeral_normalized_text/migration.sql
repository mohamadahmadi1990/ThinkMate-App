-- Add normalized text for exact matching across simple variants.
ALTER TABLE "EphemeralInput"
ADD COLUMN "normalizedText" TEXT NOT NULL DEFAULT '';

UPDATE "EphemeralInput"
SET "normalizedText" = regexp_replace(lower(btrim("text")), '[[:space:]]+', ' ', 'g');

DROP INDEX IF EXISTS "EphemeralInput_text_expiresAt_idx";

CREATE INDEX "EphemeralInput_normalizedText_expiresAt_idx"
ON "EphemeralInput"("normalizedText", "expiresAt");
