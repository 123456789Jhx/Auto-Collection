COMMENT ON COLUMN collector_devices.device_code IS '后台设备码，手机注册成功后唯一绑定；同一 device_token 不允许切换到其他 device_code';
COMMENT ON COLUMN collector_devices.device_token IS '手机本地持久化 token；同一 token 只能绑定一个后台设备码';
