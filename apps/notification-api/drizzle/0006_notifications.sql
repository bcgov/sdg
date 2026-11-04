CREATE TABLE "idempotency_keys" (
	"sender_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"notification_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_sender_id_key_pk" PRIMARY KEY("sender_id","key")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
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
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_key_notification_types_key_fk" FOREIGN KEY ("type_key") REFERENCES "public"."notification_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_sender_id_created_at_idx" ON "notifications" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_unexpanded_idx" ON "notifications" USING btree ("created_at") WHERE expanded_at IS NULL;