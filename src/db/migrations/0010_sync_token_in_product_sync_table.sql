ALTER TABLE "qb_product_sync" DROP COLUMN "id", ADD COLUMN "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), ADD COLUMN "qb_sync_token" varchar(100); --> statement-breakpoint

TRUNCATE TABLE "qb_tokens";

ALTER TABLE "qb_tokens" ADD COLUMN "income_account_ref" varchar(100) NOT NULL;