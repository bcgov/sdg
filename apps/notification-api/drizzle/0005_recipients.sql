CREATE TABLE "confirmation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"address" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"address" text NOT NULL,
	"owner_sender_id" uuid,
	"source" text NOT NULL,
	"verified_at" timestamp with time zone,
	"signing_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_points_recipient_id_channel_owner_sender_id_address_key" UNIQUE NULLS NOT DISTINCT("recipient_id","channel","owner_sender_id","address")
);
--> statement-breakpoint
CREATE TABLE "recipient_registrations" (
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipient_registrations_sender_id_recipient_id_pk" PRIMARY KEY("sender_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"issuer" text,
	"subject" text,
	"sender_id" uuid,
	"channel" text,
	"address" text,
	"reference" text,
	"system_id" text,
	"claimed_at" timestamp with time zone,
	"language" text,
	"time_zone" text,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"channels_off" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipients_issuer_subject_key" UNIQUE("issuer","subject"),
	CONSTRAINT "recipients_sender_id_channel_address_key" UNIQUE("sender_id","channel","address"),
	CONSTRAINT "recipients_sender_id_system_id_key" UNIQUE("sender_id","system_id"),
	CONSTRAINT "recipients_kind_check" CHECK ((kind = 'user' AND issuer IS NOT NULL AND subject IS NOT NULL AND sender_id IS NULL)
        OR (kind = 'address' AND sender_id IS NOT NULL AND channel IS NOT NULL AND address IS NOT NULL)
        OR (kind = 'system' AND sender_id IS NOT NULL AND system_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "topic_subscriptions" (
	"topic_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_subscriptions_topic_id_recipient_id_pk" PRIMARY KEY("topic_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"contact_point_id" uuid NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation_sends" ADD CONSTRAINT "confirmation_sends_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_points" ADD CONSTRAINT "contact_points_owner_sender_id_senders_id_fk" FOREIGN KEY ("owner_sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_registrations" ADD CONSTRAINT "recipient_registrations_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_registrations" ADD CONSTRAINT "recipient_registrations_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_subscriptions" ADD CONSTRAINT "topic_subscriptions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_subscriptions" ADD CONSTRAINT "topic_subscriptions_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_contact_point_id_contact_points_id_fk" FOREIGN KEY ("contact_point_id") REFERENCES "public"."contact_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "confirmation_sends_recipient_id_sent_at_idx" ON "confirmation_sends" USING btree ("recipient_id","sent_at");--> statement-breakpoint
CREATE INDEX "confirmation_sends_address_sent_at_idx" ON "confirmation_sends" USING btree ("address","sent_at");--> statement-breakpoint
CREATE INDEX "recipient_registrations_recipient_id_idx" ON "recipient_registrations" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "topic_subscriptions_recipient_id_idx" ON "topic_subscriptions" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "verification_tokens_contact_point_id_idx" ON "verification_tokens" USING btree ("contact_point_id");