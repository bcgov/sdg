CREATE TABLE "core"."service_client_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "core"."service_client_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_principal_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_client_events_action_check" CHECK ("core"."service_client_events"."action" in ('added', 'disabled', 'enabled', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "core"."service_clients" (
	"client_id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
