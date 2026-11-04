CREATE TABLE "template_fragment_versions" (
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
CREATE TABLE "template_versions" (
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
ALTER TABLE "template_versions" ADD CONSTRAINT "template_versions_type_key_notification_types_key_fk" FOREIGN KEY ("type_key") REFERENCES "public"."notification_types"("key") ON DELETE no action ON UPDATE no action;