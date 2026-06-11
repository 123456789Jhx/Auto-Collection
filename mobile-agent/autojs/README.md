# 手机自动化采集脚本

本目录是 Auto Collection 的手机端 AutoX.js / Auto.js 脚本工程。脚本负责在 Android 手机上运行采集流程，并把设备状态、心跳、运行日志、完整日志文件和采集记录上报到后台。

## 目录结构

```text
mobile-agent/autojs/
  main.js                 轻量入口，加载 main.module.js
  main.module.js          初始化依赖并启动应用
  launcher.js             APK 按钮页入口
  watchdog.js             守护脚本
  config.js               本地运行配置
  app/                    应用编排层
  core/                   权限、悬浮窗、OCR、日志、上传等基础能力
  domain/                 候选内容、直播评分、风险检测等业务规则
  platforms/              平台适配
  utils/                  通用工具
```

## APK 页面

APK 启动后提供简单按钮页，主要入口包括：

1. 检查权限：检查无障碍、悬浮窗、截图等运行条件。
2. 打开无障碍设置：跳转系统无障碍页面。
3. 打开悬浮窗设置：跳转系统悬浮窗权限页面。
4. 启动采集脚本：启动主采集流程。
5. 停止采集脚本：停止主采集流程。
6. 启动守护脚本：启动守护逻辑。
7. 关闭全部脚本：停止相关脚本。
8. 刷新状态：刷新当前运行状态。

## 设备身份

新版脚本会在首次运行时生成并保存本机设备 token，同时派生唯一设备 ID。默认 `android_001` 只作为旧配置占位，不再作为正式设备 ID 使用。

移动端普通接口必须带：

```text
deviceId
X-Device-Token
```

未注册设备或 token 不匹配时，后台会拒绝请求，不再自动创建设备。

## 本地日志路径

手机本地日志默认写入：

```text
/storage/emulated/0/AgriVideoCollector/datasource/运行日志/YYYY-MM-DD.log
```

其他输出目录：

```text
/storage/emulated/0/AgriVideoCollector/datasource/候选记录
/storage/emulated/0/AgriVideoCollector/datasource/截图
/storage/emulated/0/AgriVideoCollector/datasource/页面XML
```

后台结构化日志保存在数据库 `runtime_logs` 表，完整日志文件保存在 `device_log_files` 表。

## 打包 APK

在仓库根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs-apk.ps1
```

打包输出位于 `dist/`。

## 打包 AutoX 项目包

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs.ps1
```

生成的 zip 可导入 AutoX.js。

## 运行前检查

1. Android 已开启无障碍权限。
2. 已开启悬浮窗权限。
3. 截图权限已授权。
4. 网络能访问 `http://106.54.41.106:18080/api/v1`。
5. 使用新版 APK，避免旧版 `android_001` 设备 ID 被后台拒绝。

## 当前边界

1. 不绕过验证码、登录校验或平台风控。
2. 不采集非公开内容。
3. 不做自动点赞、评论、关注、私信等互动功能。
4. 不承诺平台推荐、标签或账号权重结果，只记录脚本实际运行证据。
