TRUNCATE TABLE "qb_customers";
ALTER TABLE "qb_customers" DROP COLUMN "client_id", ADD COLUMN "client_id" UUID;
