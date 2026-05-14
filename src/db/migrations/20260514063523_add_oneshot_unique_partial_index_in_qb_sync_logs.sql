CREATE UNIQUE INDEX "uq_qb_sync_logs_oneshot_active" ON "qb_sync_logs" USING btree ("portal_id","copilot_id","entity_type","event_type") WHERE "qb_sync_logs"."deleted_at" IS NULL AND (
          ("qb_sync_logs"."entity_type" = 'invoice' AND "qb_sync_logs"."event_type" IN ('created','paid','voided','deleted'))
          OR ("qb_sync_logs"."entity_type" = 'payment' AND "qb_sync_logs"."event_type" = 'succeeded')
        );
