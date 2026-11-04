CREATE TABLE "sender_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_integrations_sender_id_channel_key" UNIQUE("sender_id","channel")
);
--> statement-breakpoint
ALTER TABLE "sender_integrations" ADD CONSTRAINT "sender_integrations_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;