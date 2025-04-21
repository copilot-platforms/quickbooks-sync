CREATE TABLE "qb_invoice_sync" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qb_invoice_sync_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"portal_id" varchar(255) NOT NULL,
	"invoice_number" varchar NOT NULL,
	"qb_doc_number" varchar NOT NULL,
	"qb_invoice_id" varchar NOT NULL,
	"qb_sync_token" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_payment_sync" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qb_payment_sync_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"portal_id" varchar(255) NOT NULL,
	"payment_id" integer NOT NULL,
	"invoice_number" varchar NOT NULL,
	"qb_payment_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_product_sync" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qb_product_sync_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"portal_id" varchar(255) NOT NULL,
	"product_id" varchar NOT NULL,
	"price_id" varchar NOT NULL,
	"qb_item_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qb_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"portal_id" varchar(255) NOT NULL,
	"intuit_realm_id" varchar(255) NOT NULL,
	"access_token" varchar NOT NULL,
	"refresh_token" varchar NOT NULL,
	"expires_in" integer NOT NULL,
	"x_refresh_token_expires_in" integer NOT NULL,
	"sync_flag" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qb_tokens_portal_id_idx" ON "qb_tokens" USING btree ("portal_id");