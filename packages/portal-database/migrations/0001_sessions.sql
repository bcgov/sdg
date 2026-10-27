CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");