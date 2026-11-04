CREATE TABLE "deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"notification_recipient_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"contact_point_id" uuid,
	"address" text,
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
CREATE TABLE "delivery_attempts" (
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
CREATE TABLE "failure_callbacks" (
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
CREATE TABLE "inbox_items" (
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
CREATE TABLE "notification_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"notification_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"planned_at" timestamp with time zone,
	"escalation_stopped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_recipients_notification_id_recipient_id_key" UNIQUE("notification_id","recipient_id")
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_notification_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("notification_recipient_id") REFERENCES "public"."notification_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_contact_point_id_contact_points_id_fk" FOREIGN KEY ("contact_point_id") REFERENCES "public"."contact_points"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_callbacks" ADD CONSTRAINT "failure_callbacks_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_callbacks" ADD CONSTRAINT "failure_callbacks_sender_id_senders_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."senders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_notification_recipient_id_notification_recipients_id_fk" FOREIGN KEY ("notification_recipient_id") REFERENCES "public"."notification_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_recipients" ADD CONSTRAINT "notification_recipients_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_due_idx" ON "deliveries" USING btree ("due_at") WHERE status = 'scheduled' AND due_at IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deliveries_lease_idx" ON "deliveries" USING btree ("lease_until") WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX "deliveries_notification_recipient_id_step_idx" ON "deliveries" USING btree ("notification_recipient_id","step");--> statement-breakpoint
CREATE INDEX "deliveries_notification_id_idx" ON "deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE INDEX "deliveries_recipient_id_idx" ON "deliveries" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_email_address_key" ON "deliveries" USING btree ("notification_id","step","address") WHERE channel = 'email' AND address IS NOT NULL;--> statement-breakpoint
CREATE INDEX "delivery_attempts_delivery_id_idx" ON "delivery_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "failure_callbacks_due_idx" ON "failure_callbacks" USING btree ("due_at") WHERE status = 'scheduled';--> statement-breakpoint
CREATE INDEX "failure_callbacks_lease_idx" ON "failure_callbacks" USING btree ("lease_until") WHERE status = 'sending';--> statement-breakpoint
CREATE INDEX "inbox_items_recipient_id_created_at_idx" ON "inbox_items" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_recipients_recipient_id_idx" ON "notification_recipients" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "notification_recipients_unplanned_idx" ON "notification_recipients" USING btree ("created_at") WHERE planned_at IS NULL;