TRUNCATE TABLE "qb_tokens";--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "qb_tokens" DROP COLUMN "id", ADD COLUMN "id" UUID PRIMARY KEY DEFAULT gen_random_uuid();