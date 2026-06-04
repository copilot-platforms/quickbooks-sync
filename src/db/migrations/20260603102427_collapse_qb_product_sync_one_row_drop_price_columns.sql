CREATE UNIQUE INDEX "uq_qb_product_sync_product_active" ON "qb_product_sync" USING btree ("portal_id","product_id") WHERE "qb_product_sync"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "qb_product_sync" DROP COLUMN "price_id";--> statement-breakpoint
ALTER TABLE "qb_product_sync" DROP COLUMN "unit_price";--> statement-breakpoint
ALTER TABLE "qb_product_sync" DROP COLUMN "copilot_unit_price";