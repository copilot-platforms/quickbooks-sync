ALTER TABLE "qb_portal_connections" ADD COLUMN "bank_account_ref" varchar(100);--> statement-breakpoint
ALTER TABLE "qb_settings" ADD COLUMN "bank_deposit_fee_flag" boolean DEFAULT false NOT NULL;