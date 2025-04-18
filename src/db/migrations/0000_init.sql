CREATE TABLE "qb_tokens" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "qb_tokens_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"portal_id" varchar(255) NOT NULL,
	"intuit_realm_id" varchar(255) NOT NULL,
	"access_token" varchar NOT NULL,
	"refresh_token" varchar NOT NULL,
	"expires_in" integer NOT NULL,
	"sync_flag" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "portal_idx" ON "qb_tokens" USING btree ("portal_id");