# 开发与生产环境隔离设计

## 目标

让同一套项目源码能够稳定地产出开发版与生产版 APK，并让管理后台的开发服务与公网生产服务使用独立的运行配置、数据存储和密钥，避免本地修改影响现场设备。

## 设计

### 移动端

移动端继续使用同一套 `mobile-agent` 源码。APK 打包脚本增加环境参数：

- `production`：默认使用 `https://qk-api.dafengchan.top/api/v1`，保留现有包名、签名和升级链路。
- `development`：必须显式传入手机可访问的 API 地址，例如电脑局域网地址或临时隧道地址；不允许把 `localhost` 当作真机地址而静默打包。

开发版默认不需要 `MOBILE_REGISTRATION_SECRET`，也不会从外部 AutoJs6 暂存目录回读生产密钥；如开发 API 主动启用了注册密钥，再由当前 PowerShell 进程显式提供。生产版保留现有兼容回读逻辑并继续强制密钥。

打包时同时替换 AutoJS 上传/轮询配置、原生底座连接配置和镜像底座配置，保证内外两层不会指向不同环境。两种产物默认使用同一包名，按场景安装；如未来需要同一手机共存，再单独设计开发包名和注册体系。

### 管理后台

开发环境继续使用 `.env.development` 与开发 compose，连接本地数据库和 Redis。生产环境使用 `.env.production` 与生产 compose，数据库和 Redis 只在 compose 内网可见，服务使用 `restart: unless-stopped`，Web/API 使用实际公网域名：

- Web：`https://qk.dafengchan.top`
- API：`https://qk-api.dafengchan.top/api/v1`

生产示例只保留占位符，不提交真实密码。生产必须启用移动请求签名校验。

## 数据流

开发版 APK -> 开发 API -> 开发数据库/Redis

生产版 APK -> `qk-api.dafengchan.top` -> 生产 API -> 生产数据库/Redis

两条链路不共享运行时数据。迁移生产时只复制经过备份确认的生产数据、设备 Token 和密钥，不把开发数据库当作生产数据源。

## 验收

1. 生产构建不传参数时仍指向 `qk-api.dafengchan.top`。
2. 开发构建缺少显式 API 地址时直接失败；传入局域网/隧道地址后，APK 三处配置完全一致。
3. 生产 Web 构建使用 `qk-api.dafengchan.top`，不再出现旧域名。
4. 生产示例强制 `MOBILE_REQUEST_SIGNING_REQUIRED=true`，且不包含可直接使用的默认密码。
5. 现有生产 APK 可覆盖升级，包名和版本签名链路不变。
