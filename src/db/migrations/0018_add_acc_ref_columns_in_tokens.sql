TRUNCATE TABLE "qb_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "qb_tokens" ADD COLUMN "asset_account_ref" varchar(100) NOT NULL, ADD COLUMN "expense_account_ref" varchar(100) NOT NULL;