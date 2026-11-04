CREATE TABLE "credential_type_scopes" (
	"credential_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	CONSTRAINT "credential_type_scopes_credential_id_type_key_pk" PRIMARY KEY("credential_id","type_key")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_client_id_key" UNIQUE("client_id"),
	CONSTRAINT "credentials_id_sender_id_key" UNIQUE("id","sender_id")
);
--> statement-breakpoint
CREATE TABLE "sender_owners" (
	"sender_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_owners_sender_id_issuer_subject_pk" PRIMARY KEY("sender_id","issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "sender_type_grants" (
	"sender_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_type_grants_sender_id_type_key_pk" PRIMARY KEY("sender_id","type_key")
);
--> statement-breakpoint
CREATE TABLE "senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"callback_url" text,
	"callback_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential_type_scopes" ADD CONSTRAINT "credential_type_scopes_credential_fk" FOREIGN KEY ("credential_id","sender_id") REFERENCES "public"."credentials"("id","sender_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_type_scopes" ADD CONSTRAINT "credential_type_scopes_grant_fk" FOREIGN KEY ("sender_id","type_key") REFERENCES "public"."sender_type_grants"("sender_id","type_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_owners" ADD CONSTRAINT "sender_owners_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sender_type_grants" ADD CONSTRAINT "sender_type_grants_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credentials_sender_id_idx" ON "credentials" USING btree ("sender_id");