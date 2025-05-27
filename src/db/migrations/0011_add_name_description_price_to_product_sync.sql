TRUNCATE TABLE "qb_product_sync";

ALTER TABLE "qb_product_sync" ALTER COLUMN "qb_item_id" SET NOT NULL, 
  ALTER COLUMN "qb_sync_token" SET NOT NULL, 
  ADD COLUMN "name" varchar(100), 
  ADD COLUMN "description" varchar(255), 
  ADD COLUMN "unit_price" numeric;--> statement-breakpoint