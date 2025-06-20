CREATE TABLE "qb_expense_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"payment_id" varchar NOT NULL,
	"invoice_id" varchar NOT NULL,
	"invoice_number" varchar,
	"qb_purchase_id" varchar,
	"qb_sync_token" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
