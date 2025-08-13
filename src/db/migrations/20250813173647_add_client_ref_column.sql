ALTER TABLE "qb_product_sync" ALTER COLUMN "description" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "qb_portal_connections" ADD COLUMN "client_fee_ref" varchar(100);