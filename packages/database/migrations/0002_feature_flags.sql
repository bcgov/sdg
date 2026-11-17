CREATE TABLE "core"."feature_flag_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."feature_flag_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flag_key" text NOT NULL,
	"action" text NOT NULL,
	"actor_principal_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"subject_principal_id" uuid,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_events_action_check" CHECK ("core"."feature_flag_events"."action" in ('created', 'updated', 'deleted', 'override_set', 'override_removed'))
);
--> statement-breakpoint
CREATE TABLE "core"."feature_flag_overrides" (
	"flag_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "feature_flag_overrides_pkey" PRIMARY KEY("flag_key","user_id")
);
--> statement-breakpoint
CREATE TABLE "core"."feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_pct" smallint DEFAULT 100 NOT NULL,
	"audience" text DEFAULT 'portal' NOT NULL,
	CONSTRAINT "feature_flags_rollout_pct_check" CHECK ("core"."feature_flags"."rollout_pct" between 0 and 100),
	CONSTRAINT "feature_flags_audience_check" CHECK ("core"."feature_flags"."audience" in ('portal', 'console', 'both'))
);
--> statement-breakpoint
ALTER TABLE "core"."identities" ADD COLUMN "portal_signed_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."identities" ADD COLUMN "console_signed_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "core"."feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_flag_key_feature_flags_key_fk" FOREIGN KEY ("flag_key") REFERENCES "core"."feature_flags"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."feature_flag_overrides" ADD CONSTRAINT "feature_flag_overrides_user_id_principals_id_fk" FOREIGN KEY ("user_id") REFERENCES "core"."principals"("id") ON DELETE cascade ON UPDATE no action;