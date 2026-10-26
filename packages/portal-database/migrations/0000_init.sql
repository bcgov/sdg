CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"username" text,
	"claims" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "identities_issuer_subject_key" ON "identities" USING btree ("issuer","subject");--> statement-breakpoint
CREATE INDEX "identities_principal_id_idx" ON "identities" USING btree ("principal_id");