CREATE TABLE "qb_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"absorbed_fee_flag" boolean DEFAULT false NOT NULL,
	"company_name_flag" boolean DEFAULT false NOT NULL,
	"create_new_product_flag" boolean DEFAULT false NOT NULL,
	"create_invoice_item_flag" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
