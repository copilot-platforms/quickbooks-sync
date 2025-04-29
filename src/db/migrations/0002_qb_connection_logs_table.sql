CREATE TYPE "public"."connection_statuses" AS ENUM('pending', 'success', 'error');--> statement-breakpoint
CREATE TABLE "qb_connection_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qb_connection_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"portal_id" varchar(255) NOT NULL,
	"connection_status" "connection_statuses" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
