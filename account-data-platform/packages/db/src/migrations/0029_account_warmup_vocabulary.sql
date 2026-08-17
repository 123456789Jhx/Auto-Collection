CREATE TABLE "account_warmup_vocabulary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"value" varchar(100) NOT NULL,
	"normalized_value" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant_id" varchar(64) DEFAULT 'default' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"updated_by" varchar(64) DEFAULT 'system' NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "account_warmup_vocabulary_kind_check" CHECK ("account_warmup_vocabulary"."kind" in ('RELATED_TERM', 'COMMENT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_warmup_vocabulary_tenant_kind_normalized" ON "account_warmup_vocabulary" USING btree ("tenant_id","kind","normalized_value");--> statement-breakpoint
CREATE INDEX "idx_warmup_vocabulary_tenant_kind_last_used" ON "account_warmup_vocabulary" USING btree ("tenant_id","kind","last_used_at");