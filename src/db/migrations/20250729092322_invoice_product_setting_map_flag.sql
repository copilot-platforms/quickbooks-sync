ALTER TABLE "qb_settings" RENAME COLUMN "initial_setting_map" TO "initial_invoice_setting_map";--> statement-breakpoint
ALTER TABLE "qb_settings" ADD COLUMN "initial_product_setting_map" boolean DEFAULT false NOT NULL,
  ALTER COLUMN "initial_invoice_setting_map" SET DEFAULT false;