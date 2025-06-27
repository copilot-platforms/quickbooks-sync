CREATE TYPE "public"."connection_statuses" AS ENUM('pending', 'success', 'error');--> statement-breakpoint
CREATE TYPE "public"."invoice_statuses" AS ENUM('draft', 'open', 'paid', 'void', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."entity_types" AS ENUM('invoice', 'product', 'payment');--> statement-breakpoint
CREATE TYPE "public"."event_types" AS ENUM('created', 'updated', 'paid', 'voided', 'deleted', 'succeeded', 'mapped', 'unmapped');--> statement-breakpoint
CREATE TYPE "public"."log_statuses" AS ENUM('success', 'failed', 'info');--> statement-breakpoint
CREATE TABLE "qb_connection_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"connection_status" "connection_statuses" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"customer_id" uuid NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "qb_invoice_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"invoice_number" varchar NOT NULL,
	"qb_invoice_id" varchar,
	"qb_sync_token" varchar(100),
	"recipient_id" uuid,
	"status" "invoice_statuses" DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_payment_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"invoice_number" varchar NOT NULL,
	"total_amount" numeric NOT NULL,
	"qb_payment_id" varchar NOT NULL,
	"qb_sync_token" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_portal_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"intuit_realm_id" varchar(255) NOT NULL,
	"access_token" varchar NOT NULL,
	"refresh_token" varchar NOT NULL,
	"expires_in" integer NOT NULL,
	"x_refresh_token_expires_in" integer NOT NULL,
	"sync_flag" boolean DEFAULT false NOT NULL,
	"token_type" varchar(255),
	"token_set_time" timestamp,
	"intiated_by" varchar(255) NOT NULL,
	"income_account_ref" varchar(100) NOT NULL,
	"asset_account_ref" varchar(100) NOT NULL,
	"expense_account_ref" varchar(100) NOT NULL,
	"is_enabled" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_product_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"product_id" uuid,
	"price_id" varchar,
	"name" varchar(100),
	"description" varchar(255),
	"unit_price" numeric,
	"qb_item_id" varchar,
	"qb_sync_token" varchar(100),
	"is_excluded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "qb_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"absorbed_fee_flag" boolean DEFAULT false NOT NULL,
	"company_name_flag" boolean DEFAULT false NOT NULL,
	"create_new_product_flag" boolean DEFAULT false NOT NULL,
	"create_invoice_item_flag" boolean DEFAULT false NOT NULL,
	"initial_setting_map" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qb_sync_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portal_id" varchar(255) NOT NULL,
	"entity_type" "entity_types" DEFAULT 'invoice' NOT NULL,
	"event_type" "event_types" DEFAULT 'created' NOT NULL,
	"status" "log_statuses" DEFAULT 'success' NOT NULL,
	"sync_at" timestamp,
	"copilot_id" varchar(100) NOT NULL,
	"quickbooks_id" varchar(100),
	"invoice_number" varchar(100),
	"amount" numeric,
	"remark" varchar(255),
	"customer_name" varchar(100),
	"customer_email" varchar(100),
	"tax_amount" numeric,
	"fee_amount" numeric,
	"product_name" varchar(100),
	"product_price" numeric,
	"qb_item_name" varchar(100),
	"error_message" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_qb_portal_connections_portal_id_idx" ON "qb_portal_connections" USING btree ("portal_id");