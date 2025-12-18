DROP TYPE IF EXISTS "public"."failed_record_category_types" CASCADE;--> statement-breakpoint
CREATE TYPE "public"."failed_record_category_types" AS ENUM('auth', 'account', 'others');--> statement-breakpoint
ALTER TABLE "qb_portal_connections" ADD COLUMN "is_suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_sync_logs" ADD COLUMN "category" "failed_record_category_types" DEFAULT 'others' NOT NULL, ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;