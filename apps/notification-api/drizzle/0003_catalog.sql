CREATE TABLE "notification_types" (
	"key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"data_contract" jsonb NOT NULL,
	"default_language" text NOT NULL,
	"policy" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_broadcast_grants" (
	"topic_id" uuid NOT NULL,
	"sender_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_broadcast_grants_topic_id_sender_id_pk" PRIMARY KEY("topic_id","sender_id")
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"self_subscribe" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_sender_id_key_key" UNIQUE NULLS NOT DISTINCT("sender_id","key")
);
--> statement-breakpoint
ALTER TABLE "topic_broadcast_grants" ADD CONSTRAINT "topic_broadcast_grants_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_broadcast_grants" ADD CONSTRAINT "topic_broadcast_grants_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "topic_broadcast_grants_sender_id_idx" ON "topic_broadcast_grants" USING btree ("sender_id");--> statement-breakpoint
ALTER TABLE "sender_type_grants" ADD CONSTRAINT "sender_type_grants_type_key_notification_types_key_fk" FOREIGN KEY ("type_key") REFERENCES "public"."notification_types"("key") ON DELETE no action ON UPDATE no action;