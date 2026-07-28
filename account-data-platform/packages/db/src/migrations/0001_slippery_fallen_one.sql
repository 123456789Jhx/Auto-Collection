ALTER TABLE "collection_records" ADD COLUMN "author_name" varchar(200);--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD COLUMN "live_viewed_count" integer;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD COLUMN "live_room_entered_count" integer;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD COLUMN "live_candidate_count" integer;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD COLUMN "live_rejected_count" integer;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD COLUMN "expected_end_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "device_heartbeats" ADD COLUMN "raw_payload" jsonb;