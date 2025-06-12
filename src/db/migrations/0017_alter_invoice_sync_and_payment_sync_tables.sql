CREATE TYPE "public"."invoice_statuses" AS ENUM('open', 'draft', 'paid', 'void');--> statement-breakpoint
ALTER TABLE "qb_invoice_sync" ADD COLUMN "client_id" uuid, ADD COLUMN "status" "invoice_statuses" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_payment_sync" ADD COLUMN "total_amount" numeric NOT NULL, ADD COLUMN "qb_sync_token" varchar(100) NOT NULL, DROP COLUMN "payment_id";
