# 手机自动化采集脚本

当前目录只实现手机端 AutoX.js / Auto.js 自动化脚本，不包含后台、数据库、官方 API 和 AI 分析。

## 目录结构

```text
mobile-agent/autojs/
  main.js                 # 轻量入口，负责加载 main.module.js
  main.module.js          # 初始化依赖并启动应用
  config.js               # 本地运行配置
  app/                    # 应用编排层
    collector-app.js
    phase-runner.js
    control-loop.js
    heartbeat.js
  domain/                 # 业务规则层
    candidate-service.js
    live-scorer.js
    risk-detector.js
  core/
    permission.js
    floaty-control.js
    ocr.js
    matcher.js
    storage.js
    uploader.js
    logger.js
  utils/
    autojs-utils.js
    xml-dumper.js
  platforms/
    douyin.js
```

单文件版是生成物，不放在源码目录，生成后位于：

```text
dist/autojs/main.bundle.js
```

## 第一阶段能力

1. 检查无障碍和截图权限。
2. 显示悬浮窗：开始、暂停、跳过、采集、XML、停止。
3. 打开抖音。
4. 推荐流或搜索流浏览视频。
5. 截图并 OCR 当前页面。
6. 使用农业关键词判断候选内容。
7. 提取标题/文案、作者线索、互动指标、热门评论、OCR 可见文本。
8. 候选记录写入手机本地 JSON。
9. 如果 `config.upload.enabled = true`，再 POST 到 `config.upload.url`。
10. 定时执行：视频流随机 2-3 小时、直播流随机 1-2 小时。

## 手机运行方式

### 方式一：导入项目包运行

这种方式最快。手机需要先安装 AutoX.js，但脚本可以作为一个项目包导入，不用逐个复制文件。

在电脑执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/package-autojs.ps1
```

生成文件：

```text
dist/AgriVideoCollector-autojs-0.1.0.zip
```

然后：

1. 把这个 zip 发到手机。
2. 在 AutoX.js 中导入或解压到脚本目录。
3. 运行项目入口 `main.js`。
4. 开启无障碍、悬浮窗和截图权限。
5. 点击悬浮窗“开始”。

### 方式二：运行单文件版

如果 AutoX.js 直接运行 `main.js` 时提示 `require` 或脚本目录定位失败，可以改用单文件版：

```text
dist/autojs/main.bundle.js
```

它已经把 `config.js`、`app`、`domain`、`core`、`platforms`、`utils` 打进一个文件里，不依赖相对路径加载。

操作：

1. 把 `dist/autojs/main.bundle.js` 复制到手机。
2. 在 AutoX.js 中打开并运行 `main.bundle.js`。
3. 首次运行仍然需要开启无障碍、悬浮窗和截图权限。

当前 `main.js` 是项目化轻量入口，会加载同目录下的 `main.module.js`、`config.js`、`core`、`platforms`、`utils`。如果只想复制一个文件运行，才使用 `main.bundle.js`。

### 方式三：直接复制目录运行

1. 在 Android 手机上安装 AutoX.js 或兼容 Auto.js 的脚本运行环境。
2. 把 `mobile-agent/autojs` 目录复制到手机脚本目录。
3. 修改 `config.js`：
   - `device.deviceId`
   - `task.mode`
   - `task.keywords`
   - `upload.enabled`
   - `upload.url`
   - `schedule.videoMinutesMin`
   - `schedule.videoMinutesMax`
   - `schedule.liveMinutesMin`
   - `schedule.liveMinutesMax`
   - `task.quickCheckSecondsMin`
   - `task.quickCheckSecondsMax`
   - `task.matchedStaySecondsMin`
   - `task.matchedStaySecondsMax`
4. 在脚本 App 中运行 `main.js`。
5. 按提示开启无障碍和截图权限。
6. 点击悬浮窗“开始”。

### 方式四：打包成独立 APK

独立 APK 可以做到手机上点图标启动，但它不是当前仓库直接生成的普通 zip，需要使用 AutoX.js/Auto.js 的 APK 打包功能或单独做 Android 壳工程。

建议顺序：

1. 先用方式一在真机跑通脚本。
2. 修完抖音入口、评论入口、OCR 兼容问题。
3. 再用 AutoX.js/Auto.js 打包器选择本项目目录，入口为 `main.js`。
4. APK 首次运行仍然需要用户手动授予无障碍、悬浮窗和截图权限。

也就是说，APK 只能减少“导入脚本”的步骤，不能绕过 Android 权限授权。

## 本地输出

默认固定写入：

```text
/storage/emulated/0/安卓群控/autojs/datasource
```

也就是手机文件管理器里的：

```text
内部存储 -> 安卓群控 -> autojs -> datasource
```

目录结构：

```text
/storage/emulated/0/安卓群控/autojs/datasource/候选记录
/storage/emulated/0/安卓群控/autojs/datasource/截图      默认不写入，保留给调试开关
/storage/emulated/0/安卓群控/autojs/datasource/运行日志    运行日志，用于排查调度和采集问题
/storage/emulated/0/安卓群控/autojs/datasource/页面XML    点击 XML 时才写入
```

候选记录会生成 JSON 文件。默认不保存截图，会写运行日志。

当前 `config.js` 里默认：

```js
captureMode: "matched"
```

表示只保存命中农业关键词的视频。需要排查漏采时，可以临时改成：

```js
captureMode: "all"
```

这样会保存每条刷到的视频，便于分析 OCR 和关键词命中问题。

点击悬浮窗 `XML` 按钮会导出当前页面控件树，便于调试抖音搜索、评论等入口。

## 当前不做

1. 不点赞、评论、关注、私信。
2. 不绕过验证码、登录校验或平台风控。
3. 不批量下载完整视频。
4. 不采集非公开内容。
5. 不实现后台管理、数据库、官方 API、AI 分析和审核入库。

## 注意事项

不同手机、系统版本、抖音版本的控件结构会不同。`platforms/douyin.js` 里的搜索入口、评论入口和控件读取逻辑需要用真实手机调试后逐步增强。
