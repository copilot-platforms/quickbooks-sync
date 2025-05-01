/* 
    Unfortunately in current drizzle-kit version we can't automatically get name for primary key.
    We are working on making it available!

    Meanwhile you can:
        1. Check pk name in your database, by running
            SELECT constraint_name FROM information_schema.table_constraints
            WHERE table_schema = 'public'
                AND table_name = 'qb_tokens'
                AND constraint_type = 'PRIMARY KEY';
        2. Uncomment code below and paste pk name manually
        
    Hope to release this update as soon as possible
*/

TRUNCATE TABLE "qb_tokens";--> statement-breakpoint
ALTER TABLE "qb_tokens" DROP CONSTRAINT "qb_tokens_pkey", ADD COLUMN "uuid" varchar(255) PRIMARY KEY;--> statement-breakpoint
