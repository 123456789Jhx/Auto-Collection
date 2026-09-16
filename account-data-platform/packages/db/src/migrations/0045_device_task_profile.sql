ALTER TABLE device_task_configs ADD COLUMN IF NOT EXISTS device_profile jsonb;

COMMENT ON COLUMN device_task_configs.device_profile IS '设备画像覆盖：按机型调整手机端运行时行为（截图授权流程、输出目录候选、打开抖音后的等待区间等），服务端取值优先于 APK 内置画像';
