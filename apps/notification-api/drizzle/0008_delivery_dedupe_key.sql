DROP INDEX "deliveries_email_address_key";--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_dedupe_key" ON "deliveries" USING btree ("notification_id","step","dedupe_key") WHERE dedupe_key IS NOT NULL;