ALTER TABLE live_target_feature_configs
  ADD COLUMN IF NOT EXISTS revision integer;

UPDATE live_target_feature_configs
SET revision = 1
WHERE revision IS NULL;

ALTER TABLE live_target_feature_configs
  ALTER COLUMN revision SET DEFAULT 1,
  ALTER COLUMN revision SET NOT NULL;

ALTER TABLE live_target_feature_configs
  ADD COLUMN IF NOT EXISTS config_hash varchar(64);

ALTER TABLE collector_devices
  ADD COLUMN IF NOT EXISTS capabilities_json jsonb;

ALTER TABLE collector_devices
  ADD COLUMN IF NOT EXISTS capabilities_reported_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS feature_rollout_controls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key varchar(100) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1,
  min_app_version varchar(64),
  required_capabilities_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  capability_ttl_seconds integer NOT NULL DEFAULT 600,
  reason varchar(500),
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_feature_rollout_controls_tenant_feature
  ON feature_rollout_controls (tenant_id, feature_key)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS feature_rollout_control_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id uuid NOT NULL REFERENCES feature_rollout_controls(id),
  feature_key varchar(100) NOT NULL,
  from_revision integer NOT NULL,
  to_revision integer NOT NULL,
  before_json jsonb NOT NULL,
  after_json jsonb NOT NULL,
  reason varchar(500) NOT NULL,
  actor varchar(64) NOT NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_feature_rollout_control_events_tenant_feature_occurred
  ON feature_rollout_control_events (tenant_id, feature_key, occurred_at);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_feature_rollout_control_events_tenant_control_revision
  ON feature_rollout_control_events (tenant_id, control_id, to_revision);

CREATE TABLE IF NOT EXISTS feature_rollout_device_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key varchar(100) NOT NULL,
  device_id uuid NOT NULL REFERENCES collector_devices(id),
  enabled boolean NOT NULL DEFAULT true,
  tenant_id varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by varchar(64) NOT NULL DEFAULT 'system',
  updated_by varchar(64) NOT NULL DEFAULT 'system',
  deleted_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_feature_rollout_device_allowlist_tenant_feature
  ON feature_rollout_device_allowlist (tenant_id, feature_key);

CREATE INDEX IF NOT EXISTS idx_feature_rollout_device_allowlist_tenant_device
  ON feature_rollout_device_allowlist (tenant_id, device_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_feature_rollout_device_allowlist_tenant_feature_device
  ON feature_rollout_device_allowlist (tenant_id, feature_key, device_id)
  WHERE deleted_at IS NULL;

INSERT INTO feature_rollout_controls (
  feature_key,
  enabled,
  revision,
  required_capabilities_json,
  capability_ttl_seconds,
  reason,
  created_by,
  updated_by
)
VALUES
  (
    'commerce_card_workflow_v2',
    false,
    1,
    '["workflow_v2","checkpoint_v2","pause_resume","stable_room_key"]'::jsonb,
    600,
    '阶段 A 配置准备，默认禁止执行',
    'migration',
    'migration'
  ),
  (
    'commerce_card_real_comment',
    false,
    1,
    '["workflow_v2","checkpoint_v2","pause_resume","stable_room_key","idempotent_comment","short_lived_comment_permit"]'::jsonb,
    600,
    '阶段 A 配置准备，默认禁止真实评论',
    'migration',
    'migration'
  )
ON CONFLICT DO NOTHING;
