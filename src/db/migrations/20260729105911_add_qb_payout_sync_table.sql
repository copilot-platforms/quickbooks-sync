CREATE TABLE "qb_payout_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"payout_id" varchar(100) NOT NULL,
	"line_items" jsonb NOT NULL,
	"net_amount" integer NOT NULL,
	"fee_amount" integer NOT NULL,
	"arrival_date" integer NOT NULL,
	"qb_deposit_id" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qb_payout_sync_portal_payout_active" ON "qb_payout_sync" USING btree ("portal_id","payout_id") WHERE "qb_payout_sync"."deleted_at" is null;