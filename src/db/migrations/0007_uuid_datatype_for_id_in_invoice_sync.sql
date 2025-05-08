TRUNCATE TABLE "qb_invoice_sync";--> statement-breakpoint

ALTER TABLE "qb_invoice_sync" DROP COLUMN "id", ADD COLUMN "id" UUID PRIMARY KEY DEFAULT gen_random_uuid();
