ALTER TABLE "provider_sync_runs" ADD COLUMN "kind" text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD COLUMN "as_of" date;--> statement-breakpoint
ALTER TABLE "provider_sync_runs" ADD CONSTRAINT "provider_sync_runs_kind_check" CHECK ("provider_sync_runs"."kind" IN ('full','daily'));