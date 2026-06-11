# Auto Collection

脚本自动化采集以及后台监控项目。

当前目录：

```text
mobile-agent/            手机端 AutoJS/AutoX 脚本与 APK 打包工程
account-data-platform/   账号数据与设备监控后台
docs/                    需求、方案和项目记录
scripts/                 打包和辅助脚本
```

手机端最新版 APK 通过以下脚本构建：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-autojs-apk.ps1
```

后台工程请进入 `account-data-platform/` 查看启动说明。
