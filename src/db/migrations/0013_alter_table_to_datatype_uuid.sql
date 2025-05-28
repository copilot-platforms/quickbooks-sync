ALTER TABLE "qb_payment_sync" DROP COLUMN "id", ADD COLUMN "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), DROP COLUMN "payment_id", ADD COLUMN "payment_id" UUID;--> statement-breakpoint
ALTER TABLE "qb_product_sync" ALTER COLUMN "product_id" SET DATA TYPE UUID USING product_id::UUID;
