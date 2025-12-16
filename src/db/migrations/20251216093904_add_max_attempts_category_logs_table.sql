CREATE TYPE "public"."category_types" AS ENUM('auth', 'account', 'others');--> statement-breakpoint
ALTER TABLE "qb_portal_connections" ADD COLUMN "is_suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_sync_logs" ADD COLUMN "category" "category_types" DEFAULT 'others' NOT NULL;