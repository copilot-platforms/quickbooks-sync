CREATE TABLE "qb_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"client_id" varchar(255) NOT NULL,
	"given_name" varchar(255),
	"family_name" varchar(255),
	"email" varchar(255),
	"company_name" varchar(255),
	"qb_sync_token" varchar(100) NOT NULL,
	"qb_customer_id" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
