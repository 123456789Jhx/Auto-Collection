CREATE TABLE "biz_script_previews" (
  "id" uuid PRIMARY KEY REFERENCES "agent_versions"("id"),
  "tenant_id" varchar(64) NOT NULL,
  "stage" varchar(16) DEFAULT 'DRAFT' NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "preview_json" jsonb NOT NULL,
  "test_device_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "device_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "created_by" varchar(64) NOT NULL,
  "updated_by" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_biz_script_previews_tenant_created_at" ON "biz_script_previews" ("tenant_id", "created_at");
--> statement-breakpoint
CREATE TABLE "biz_script_archives" (
  "id" uuid PRIMARY KEY REFERENCES "biz_script_previews"("id"),
  "tenant_id" varchar(64) NOT NULL,
  "archive_base64" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "biz_script_audits" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "preview_id" uuid NOT NULL REFERENCES "biz_script_previews"("id"),
  "tenant_id" varchar(64) NOT NULL,
  "stage" varchar(16) NOT NULL,
  "revision" integer NOT NULL,
  "test_device_ids" jsonb NOT NULL,
  "device_ids" jsonb NOT NULL,
  "actor" varchar(64) NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_biz_script_audits_revision" ON "biz_script_audits" ("tenant_id", "preview_id", "revision");
