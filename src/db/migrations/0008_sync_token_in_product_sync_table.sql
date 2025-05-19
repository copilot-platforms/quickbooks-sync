ALTER TABLE "qb_product_sync" DROP COLUMN "id", ADD COLUMN "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), ADD COLUMN "qb_sync_token" varchar(100); --> statement-breakpoint
