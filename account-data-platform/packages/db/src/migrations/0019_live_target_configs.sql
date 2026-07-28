CREATE TABLE IF NOT EXISTS live_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_code varchar(64) NOT NULL,
  target_name varchar(200) NOT NULL,
  platform varchar(32) NOT NULL DEFAULT 'douyin',
  similarity_threshold integer NOT NULL DEFAULT 90,
  enabled boolean NOT NULL DEFAULT true,
  remark varchar(500),
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_targets_tenant_target_code
  ON live_targets (tenant_id, target_code)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_live_targets_tenant_platform_enabled
  ON live_targets (tenant_id, platform, enabled);

CREATE TABLE IF NOT EXISTS live_target_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES live_targets(id),
  alias_text varchar(200) NOT NULL,
  alias_type varchar(32) NOT NULL DEFAULT 'room_name',
  weight integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_live_target_aliases_tenant_target
  ON live_target_aliases (tenant_id, target_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_target_aliases_tenant_target_text
  ON live_target_aliases (tenant_id, target_id, alias_text)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS live_target_feature_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid NOT NULL REFERENCES live_targets(id),
  feature_type varchar(64) NOT NULL,
  search_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  forbidden_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  live_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  runtime_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_live_target_feature_configs_tenant_target
  ON live_target_feature_configs (tenant_id, target_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_target_feature_configs_tenant_target_feature
  ON live_target_feature_configs (tenant_id, target_id, feature_type)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS live_target_device_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES collector_devices(id),
  target_id uuid NOT NULL REFERENCES live_targets(id),
  feature_type varchar(64) NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_live_target_device_bindings_tenant_device
  ON live_target_device_bindings (tenant_id, device_id);

CREATE INDEX IF NOT EXISTS idx_live_target_device_bindings_tenant_target
  ON live_target_device_bindings (tenant_id, target_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_live_target_device_bindings_tenant_device_target_feature
  ON live_target_device_bindings (tenant_id, device_id, target_id, feature_type)
  WHERE deleted_at IS NULL;
