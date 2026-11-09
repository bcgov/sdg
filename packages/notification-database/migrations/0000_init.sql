CREATE SCHEMA "notification";
--> statement-breakpoint
CREATE TABLE "notification"."failure_callbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"reason" text,
	"due_at" timestamp with time zone NOT NULL,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "failure_callbacks_delivery_id_key" UNIQUE("delivery_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."notification_types" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"data_contract" jsonb NOT NULL,
	"default_language" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."credential_type_scopes" (
	"credential_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	CONSTRAINT "credential_type_scopes_credential_id_type_key_pk" PRIMARY KEY("credential_id","type_key")
);
--> statement-breakpoint
CREATE TABLE "notification"."credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_client_id_key" UNIQUE("client_id"),
	CONSTRAINT "credentials_id_sender_id_key" UNIQUE("id","sender_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"notification_recipient_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"contact_point_id" uuid,
	"address" text,
	"dedupe_key" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"reason" text,
	"due_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"integration_id" text,
	"integration_version" text,
	"status" text NOT NULL,
	"error" text,
	"rendered" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_recipient_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"title" text,
	"body" text,
	"action_url" text,
	"language" text,
	"template_version_id" uuid,
	"read_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_items_notification_recipient_id_key" UNIQUE("notification_recipient_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"planned_at" timestamp with time zone,
	"escalation_stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipients_notification_id_recipient_id_key" UNIQUE("notification_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."sender_integrations" (
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
CREATE TABLE "notification"."idempotency_keys" (
	"sender_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"notification_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_sender_id_key_pk" PRIMARY KEY("sender_id","key")
);
--> statement-breakpoint
CREATE TABLE "notification"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"credential_id" uuid,
	"type_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"audience_kind" text NOT NULL,
	"recipient_ids" uuid[],
	"topic_id" uuid,
	"pinned" jsonb NOT NULL,
	"policy" jsonb NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"expanded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_audience_check" CHECK ((audience_kind = 'recipients' AND recipient_ids IS NOT NULL AND topic_id IS NULL)
        OR (audience_kind = 'topic' AND recipient_ids IS NULL)
        OR (audience_kind = 'everyone' AND recipient_ids IS NULL AND topic_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "notification"."confirmation_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"address" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."contact_points" (
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
CREATE TABLE "notification"."recipient_registrations" (
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recipient_registrations_sender_id_recipient_id_pk" PRIMARY KEY("sender_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."recipients" (
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
CREATE TABLE "notification"."topic_subscriptions" (
	"topic_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_subscriptions_topic_id_recipient_id_pk" PRIMARY KEY("topic_id","recipient_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"contact_point_id" uuid NOT NULL,
	"address" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."sender_owners" (
	"sender_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_owners_sender_id_issuer_subject_pk" PRIMARY KEY("sender_id","issuer","subject")
);
--> statement-breakpoint
CREATE TABLE "notification"."sender_type_grants" (
	"sender_id" uuid NOT NULL,
	"type_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sender_type_grants_sender_id_type_key_pk" PRIMARY KEY("sender_id","type_key")
);
--> statement-breakpoint
CREATE TABLE "notification"."senders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"callback_url" text,
	"callback_secret" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification"."template_fragment_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"references" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_fragment_versions_name_version_key" UNIQUE("name","version")
);
--> statement-breakpoint
CREATE TABLE "notification"."template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type_key" text NOT NULL,
	"channel" text NOT NULL,
	"language" text NOT NULL,
	"version" integer NOT NULL,
	"parts" jsonb NOT NULL,
	"references" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_versions_type_key_channel_language_version_key" UNIQUE("type_key","channel","language","version")
);
--> statement-breakpoint
CREATE TABLE "notification"."topic_broadcast_grants" (
	"topic_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_broadcast_grants_topic_id_sender_id_pk" PRIMARY KEY("topic_id","sender_id")
);
--> statement-breakpoint
CREATE TABLE "notification"."topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"self_subscribe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_sender_id_key_key" UNIQUE NULLS NOT DISTINCT("sender_id","key")
);
--> statement-breakpoint
ALTER TABLE "notification"."failure_callbacks" ADD CONSTRAINT "failure_callbacks_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "notification"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."failure_callbacks" ADD CONSTRAINT "failure_callbacks_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."credential_type_scopes" ADD CONSTRAINT "credential_type_scopes_credential_fk" FOREIGN KEY ("credential_id","sender_id") REFERENCES "notification"."credentials"("id","sender_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."credential_type_scopes" ADD CONSTRAINT "credential_type_scopes_grant_fk" FOREIGN KEY ("sender_id","type_key") REFERENCES "notification"."sender_type_grants"("sender_id","type_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."credentials" ADD CONSTRAINT "credentials_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."deliveries" ADD CONSTRAINT "deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "notification"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."deliveries" ADD CONSTRAINT "deliveries_notification_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("notification_recipient_id") REFERENCES "notification"."notification_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."deliveries" ADD CONSTRAINT "deliveries_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."deliveries" ADD CONSTRAINT "deliveries_contact_point_id_contact_points_id_fk" FOREIGN KEY ("contact_point_id") REFERENCES "notification"."contact_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "notification"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."inbox_items" ADD CONSTRAINT "inbox_items_notification_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("notification_recipient_id") REFERENCES "notification"."notification_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."inbox_items" ADD CONSTRAINT "inbox_items_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "notification"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."inbox_items" ADD CONSTRAINT "inbox_items_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "notification"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."notification_recipients" ADD CONSTRAINT "notification_recipients_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."sender_integrations" ADD CONSTRAINT "sender_integrations_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "notification"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."notifications" ADD CONSTRAINT "notifications_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."notifications" ADD CONSTRAINT "notifications_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "notification"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."notifications" ADD CONSTRAINT "notifications_type_key_notification_types_key_fk" FOREIGN KEY ("type_key") REFERENCES "notification"."notification_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."notifications" ADD CONSTRAINT "notifications_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "notification"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."confirmation_sends" ADD CONSTRAINT "confirmation_sends_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."contact_points" ADD CONSTRAINT "contact_points_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."contact_points" ADD CONSTRAINT "contact_points_owner_sender_id_senders_id_fk" FOREIGN KEY ("owner_sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."recipient_registrations" ADD CONSTRAINT "recipient_registrations_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."recipient_registrations" ADD CONSTRAINT "recipient_registrations_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."recipients" ADD CONSTRAINT "recipients_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."topic_subscriptions" ADD CONSTRAINT "topic_subscriptions_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "notification"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."topic_subscriptions" ADD CONSTRAINT "topic_subscriptions_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "notification"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."verification_tokens" ADD CONSTRAINT "verification_tokens_contact_point_id_contact_points_id_fk" FOREIGN KEY ("contact_point_id") REFERENCES "notification"."contact_points"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."sender_owners" ADD CONSTRAINT "sender_owners_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."sender_type_grants" ADD CONSTRAINT "sender_type_grants_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."sender_type_grants" ADD CONSTRAINT "sender_type_grants_type_key_notification_types_key_fk" FOREIGN KEY ("type_key") REFERENCES "notification"."notification_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."template_versions" ADD CONSTRAINT "template_versions_type_key_notification_types_key_fk" FOREIGN KEY ("type_key") REFERENCES "notification"."notification_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."topic_broadcast_grants" ADD CONSTRAINT "topic_broadcast_grants_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "notification"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."topic_broadcast_grants" ADD CONSTRAINT "topic_broadcast_grants_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification"."topics" ADD CONSTRAINT "topics_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "notification"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "failure_callbacks_due_idx" ON "notification"."failure_callbacks" USING btree ("due_at") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "failure_callbacks_lease_idx" ON "notification"."failure_callbacks" USING btree ("lease_until") WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX "credentials_sender_id_idx" ON "notification"."credentials" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "notification"."deliveries" USING btree ("due_at") WHERE status = 'scheduled' AND due_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deliveries_lease_idx" ON "notification"."deliveries" USING btree ("lease_until") WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX "deliveries_notification_recipient_id_step_idx" ON "notification"."deliveries" USING btree ("notification_recipient_id","step");--> statement-breakpoint
CREATE INDEX "deliveries_notification_id_idx" ON "notification"."deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "deliveries_recipient_id_idx" ON "notification"."deliveries" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_dedupe_key" ON "notification"."deliveries" USING btree ("notification_id","step","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_attempts_delivery_id_idx" ON "notification"."delivery_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "inbox_items_recipient_id_created_at_idx" ON "notification"."inbox_items" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_recipients_recipient_id_idx" ON "notification"."notification_recipients" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "notification_recipients_unplanned_idx" ON "notification"."notification_recipients" USING btree ("created_at") WHERE planned_at IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_sender_id_created_at_idx" ON "notification"."notifications" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unexpanded_idx" ON "notification"."notifications" USING btree ("created_at") WHERE expanded_at IS NULL;--> statement-breakpoint
CREATE INDEX "confirmation_sends_recipient_id_sent_at_idx" ON "notification"."confirmation_sends" USING btree ("recipient_id","sent_at");--> statement-breakpoint
CREATE INDEX "confirmation_sends_address_sent_at_idx" ON "notification"."confirmation_sends" USING btree ("address","sent_at");--> statement-breakpoint
CREATE INDEX "recipient_registrations_recipient_id_idx" ON "notification"."recipient_registrations" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "topic_subscriptions_recipient_id_idx" ON "notification"."topic_subscriptions" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "verification_tokens_contact_point_id_idx" ON "notification"."verification_tokens" USING btree ("contact_point_id");--> statement-breakpoint
CREATE INDEX "topic_broadcast_grants_sender_id_idx" ON "notification"."topic_broadcast_grants" USING btree ("sender_id");