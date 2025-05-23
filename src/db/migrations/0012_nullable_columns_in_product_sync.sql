ALTER TABLE "qb_product_sync" ALTER COLUMN "product_id" DROP NOT NULL, 
  ALTER COLUMN "price_id" DROP NOT NULL, 
  ALTER COLUMN "qb_item_id" DROP NOT NULL, 
  ALTER COLUMN "qb_sync_token" DROP NOT NULL;
  