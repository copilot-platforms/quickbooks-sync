CREATE TYPE "public"."entity_types" AS ENUM('invoice', 'product', 'payment');--> statement-breakpoint
CREATE TYPE "public"."event_types" AS ENUM('created', 'updated', 'paid', 'voided', 'deleted', 'succeeded');--> statement-breakpoint
CREATE TYPE "public"."log_statuses" AS ENUM('success', 'failed', 'info');--> statement-breakpoint
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
