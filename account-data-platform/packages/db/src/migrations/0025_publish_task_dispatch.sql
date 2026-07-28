ALTER TABLE "publish_tasks" ADD COLUMN "result_error" text;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "published_url" text;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "platform_content_id" varchar(255);--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_tasks" ADD COLUMN "reported_at" timestamp with time zone;