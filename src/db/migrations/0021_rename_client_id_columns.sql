ALTER TABLE "qb_customers" RENAME COLUMN "client_id" TO "customer_id";--> statement-breakpoint
ALTER TABLE "qb_invoice_sync" RENAME COLUMN "client_id" TO "recipient_id";