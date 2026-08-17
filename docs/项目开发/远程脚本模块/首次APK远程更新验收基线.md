# 首次 APK 远程更新验收基线

## 记录信息

- 记录时间：2026-08-08 13:43:06 +08:00
- 用途：证明首次 APK 安装后，后续测试变化来自更新中心，而不是预先打入 APK。
- 本文只记录基线，不代表已经打包、安装或发布。

## APK 源码身份

- 应用版本：`1.0.75`
- versionCode：`111`
- 包名：`com.agri.video.collector`
- buildId：`AGRI-20260618114441`
- buildNumber：`27`
- project.json 内 buildTime：`2026-06-18 11:44:41 +08:00`

## 首次 APK 基础文件 SHA256

| 文件 | SHA256 |
| --- | --- |
| `app/biz-script-updater.js` | `ca194711e973442a2e4b78746e07415e786aec1a20a69fdcdc13ec3b4c5128b4` |
| `app/heartbeat.js` | `4855bdf05ac893ed6cdb9a11f5ae5857a6b6c47d8fcae723c21de8f1214b0b80` |
| `main.module.js` | `95bc23716eee07ed227f47a3f5ef2dd41d5d1cc18e9f29d0497476e5bfd7bea2` |
| `app/control-loop.js` | `2013e075f158512e555ddde0161427c99c7f77869e7cc0bf020bcca8a6b8d269` |
| `app/single-interface-publish-command-bridge.js` | `43c7d4d6349fdfac3309b42f7421e14188ec2fb5789c4c9f796cf3b6c8cfc7aa` |

## 远程业务脚本基线

- 最新本地发布产物版本：`1.3.16.20260807123000`
- 文件数量：`49`
- ZIP SHA256：`73e69bfaa6a18f1d0e85db65b57142f469e49619642973b26a5f59388bf1726e`
- manifest 与 ZIP 实际 SHA256：一致
- `features/publish-video/publish-video-entry.js` SHA256：`3dfd79be58f4bb69060efa3a3a2a7dbfae4ce576e738d6d3b891ad9e228f7cab`
- 当前源码与该发布产物中的 `publish-video-entry.js` SHA256：一致

## 测试隔离条件

- 基线源码中不存在 `REMOTE_BIZ_UPDATE_PROBE`。
- 首次 APK 必须在加入远程测试标记前完成构建。
- APK 构建完成前不得修改上述六个基线文件。
- 测试变化只能放入 `features/` 或 `domain/`，不得修改 `app/`、`main.module.js`、权限或 API 地址。
- 手机处于 `idle` 状态时才允许拉取业务脚本更新。

## 后续验收依据

首次 APK 安装后，再向远程业务脚本加入 `REMOTE_BIZ_UPDATE_PROBE_V1`。只有同时满足以下条件，才说明远程更新真实生效：

1. APK 版本仍为 `1.0.75 (111)`。
2. 管理后台显示新的业务脚本版本已生效。
3. 手机执行发布任务时出现 `REMOTE_BIZ_UPDATE_PROBE_V1` 日志。
4. 基线记录证明首次 APK 构建前不存在该标记。

## 节点3首次 APK 构建结果

- APK：`dist/apk/燎原星火-1.0.75-inrt.apk`
- 最后写入时间：`2026-08-08 14:05:52 +08:00`
- 文件大小：`66,688,380` bytes
- APK SHA256：`ae29d31b32fdefd8924ad971d94608c581121a7ad6985f109779dc8207b38143`
- SHA256 侧车文件：匹配
- 包名：`com.agri.video.collector`
- 版本：`1.0.75 (111)`
- APK 签名：v2、v3 验证通过
- 签名证书 SHA256：`eb2913f5c1e52c2b1b94f458b3f2a1818fd52ff15468815563221c62d3209216`
- zipalign：通过
- 六个基础文件的包内 SHA256：全部与本基线一致
- APK 内 `REMOTE_BIZ_UPDATE_PROBE`：不存在
- 安装设备：`MI 8 (ADB 3f79ff76)`
- 安装方式：`adb install -r` 覆盖安装，保留应用数据
- 设备安装结果：`Success`
- 设备实际版本：`1.0.75 (111)`
- 设备 lastUpdateTime：`2026-08-08 14:21:10`
- 本节点未启动 Agent、未发布业务脚本、未重启服务。

## 1.0.76 空闲更新门禁修正

- 修正内容：`collector-app.js` 的所有业务脚本检查统一要求当前状态为 `idle`。
- APK：`dist/apk/燎原星火-1.0.76-inrt.apk`
- APK SHA256：`d2486785ed47fd7fa352a5c0acb0adb6946f23adfa423a6dbdc9555faba066a2`
- 包名与版本：`com.agri.video.collector / 1.0.76 (112)`
- APK 签名：v2、v3 验证通过
- zipalign：通过
- 安装设备：`MI 8 (ADB 3f79ff76)`
- 覆盖安装时间：`2026-08-08 15:31:21 +08:00`
- 真机观察区间：`2026-08-08 15:33:59` 至 `15:35:13`
- 观察状态：设备与心跳均为 `paused`，心跳持续刷新。
- 安装后业务脚本更新事件数：`0`
- 最后一条更新事件仍为安装前的 `2026-08-08 15:31:20`。
- 结论：`paused` 状态不再检查、下载或切换业务脚本，空闲门禁真机生效。
