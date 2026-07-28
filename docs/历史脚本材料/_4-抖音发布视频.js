/**
 * 名称：抖音发布视频
 * 运行环境：Auto.js
 * 适配应用：抖音
 * 版本：1.0.0
 * 更新时间：2026.04.08
 * 功能描述：发布抖音视频
 * 注意事项：
 * 1. 请确保抖音已登录，且账号有足够的权限进行操作。
 * 2. 脚本运行时，请勿操作抖音界面，以免干扰脚本执行。
 */

/**
 * 抖音发布视频:
 * 清理相册(图片与视频)
 * 关闭抖音
 *
 * 打开抖音
 * 首页点发布tab
 * 点击上传视频按钮
 * 选择视频文件
 * 输入视频描述
 * 点击发布按钮
 *
 */


// 随机数函数
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机数函数(包含小数)
function random(min, max, precision = 2) {
  return Number((Math.random() * (max - min) + min).toFixed(precision));
}

// 获取当前前台APP包名
function getCurrentPackage() {
  let windows = auto.windows;
  for (let w of windows) {
    // 类型 1 = 应用窗口，并且获得焦点
    if (w.getType() === 1 && w.isFocused()) {
      return app.getPackageName(w.getTitle());
    }
  }
  throw new Error("未找到当前前台应用窗口");
}

// 校验当前应用包名
function verifyApp(stepName, appName = "抖音") {
  toast(`[校验app] ${stepName}`);
  let currentPkg = getCurrentPackage();
  if (currentPkg !== app.getPackageName(appName)) {
    throw new Error(`当前应用不是 ${appName}，当前包名：${currentPkg}`);
  }
}

// 等待控件出现（增强版）
function waitForElement(selector, timeout = 5000, region = null) {
  // 计算结束时间
  const endTime = Date.now() + timeout;

  while (true) {
    let element = null;
    try {
      // 区域查找
      if (region) {
        element = selector.boundsInside(region.x1, region.y1, region.x2, region.y2).findOne(100); // 0=立即查找，提高效率
      }
      // 全屏查找
      else {
        element = selector.findOne(100);
      }

      // 找到控件直接返回
      if (element) {
        return element;
      }
    } catch (e) {
      // 捕获异常，防止脚本崩溃
      log("查找控件异常：" + e);
    }

    // 轮询间隔，避免CPU占用过高
    sleep(100);

    if (endTime - Date.now() < 0) {
      // 超时未找到
      console.log("[" + timeout + "ms] 未找到目标控件");
      return null;
    }
  }


}

// 安全点击控件（精简版）
function safeClick(uiObject, maxDepth = 3) {
  if (!uiObject) return false;

  // 1. 优先原生点击
  try {
    if (uiObject.clickable() && uiObject.click()) {
      console.log("找到可点击元素，直接点击...");
      // 随机等待 500-1000 毫秒，模拟人类操作间隔
      sleep(randomInt(500, 1000));
      return true;
    }
  } catch (e) { }

  // 2. 向上找可点击父节点（最多3层）
  try {
    let parent = uiObject.parent();
    let depth = 1;
    while (parent && depth++ <= maxDepth) {
      if (parent.clickable() && parent.click()) {
        console.log(`找到可点击父节点[第${depth}层]，点击...`);
        // 随机等待 500-1000 毫秒，模拟人类操作间隔
        sleep(randomInt(500, 1000));
        return true;
      }
      parent = parent.parent();
    }
  } catch (e) { }


  throw new Error(`点击元素(${uiObject})失败`);
}

// 坐标点击（优化版：带随机偏移 + 防误触 + 防检测）
function axisClick(uiObject) {
  if (!uiObject) return false;

  let b = uiObject.bounds();
  if (!b || b.width() <= 0 || b.height() <= 0) {
    console.log("坐标点击失败：控件区域无效");
    return false;
  }

  // 过滤屏幕外控件
  if (b.right < 0 || b.bottom < 0 || b.top > device.height) {
    console.log("控件在屏幕外，无法点击");
    return false;
  }

  // 随机偏移
  let x = b.centerX() + randomInt(-2, 2);
  let y = b.centerY() + randomInt(-2, 2);

  // 边界保护
  x = Math.max(0, Math.min(x, device.width));
  y = Math.max(0, Math.min(y, device.height));

  // 随机按压时间
  let pressTime = randomInt(100, 150);
  console.log(`坐标点击：(${x}, ${y}) 时长：${pressTime}ms`);

  press(x, y, pressTime);
  sleep(randomInt(500, 1000));
  return true;
}

// 获取剪贴板内容（文本格式）
function getClipText() {// 必须创建悬浮窗获取焦点（安卓10+必备）
  let floatWindow = floaty.window(
    <frame bg="#00000000" w="1px" h="1px" />
  );
  // 请求界面焦点（核心！）
  ui.run(function () {
    floatWindow.requestFocus();
  });
  sleep(300); // 等待焦点生效
  // 这个版本直接用全局函数 getClip()
  let clipboardText = getClip();
  toast("✅ 剪贴板内容：", clipboardText);
  // 用完关闭悬浮窗
  floatWindow.close();
  return clipboardText;
}




// --- 全局配置 ---
const API_BASE_URL = "https://wyts-media-api.wuyoutansuo.com";
const API_KEY = "S44saDEQbERffc82EGe9CS7xsDABP349";

// --- 核心业务逻辑 ---
const DouyinApp = {
  // 强制关闭抖音
  kill() {
    console.info("关闭抖音");
    // 打开应用设置
    app.openAppSetting(app.getPackageName("抖音") || "com.ss.android.ugc.aweme");
    // 等待 2-3 秒，确保设置界面加载完成
    sleep(randomInt(2000, 3000));

    // 查找并点击 强制停止 按钮
    let stopBtn = waitForElement(textMatches(/.*(强行停止|强制停止|结束运行|Force stop).*/), 3000) ||
      waitForElement(descMatches(/.*(强行停止|强制停止|结束运行|Force stop).*/), 1000);

    // 点击 强制停止 按钮
    if (stopBtn) {
      console.log("找到 强制停止 按钮，尝试点击...");
      axisClick(stopBtn)
      // 随机等待 1-2 秒，模拟人类操作间隔
      sleep(randomInt(1000, 2000));
    } else {
      throw new Error("未找到可点击的强制停止按钮");
    }

    // 等待确认弹窗出现
    let confirmBtn = waitForElement(textMatches(/.*(确定|确认|好|OK).*/).clickable(true), 3000);
    if (confirmBtn) {
      console.log("找到 确定 按钮，尝试点击...");
      safeClick(confirmBtn);
      // 随机等待 1-2 秒，模拟人类操作间隔
      sleep(randomInt(1000, 2000));
    }
    console.log("应用已强制停止");
    console.log("抖音已关闭");
    home();
    // 随机等待 1-2 秒，模拟人类操作间隔
    sleep(randomInt(1000, 2000));
  },

  // 启动并等待
  launch() {
    console.info("打开抖音");
    // 先回到桌面，确保启动环境干净
    home();
    // 随机等待 1-2 秒，模拟人类操作间隔
    sleep(randomInt(1000, 2000));

    if (app.launchApp("抖音") || app.launch("com.ss.android.ugc.aweme")) {
      console.log("抖音已打开");
    } else {
      throw new Error("抖音打开失败");
    }
    // 点击 允许 打开抖音
    let allowBtn = waitForElement(textMatches(/.*(允许).*/).clickable(true), 3000);
    if (allowBtn) {
      console.log("找到 允许 按钮，尝试点击...");
      safeClick(allowBtn);
      // 随机等待 1-2 秒，模拟人类操作间隔
      sleep(randomInt(1000, 2000));
    }

    // 分阶段等待：启动页 → 广告 → 主界面
    console.log("等待抖音主界面加载...");
    // 随机等待 3-5 秒，模拟启动页 + 广告加载时间
    sleep(randomInt(3000, 5000));

    // 判断 "温馨提示" 弹窗 是否存在
    let tipBtn = waitForElement(text("温馨提示"), 5000);
    if (tipBtn) {
      // 点击 屏幕 下方 空白区域
      // 获取屏幕下方的空白区域
      let device_width = device.width || 1080;
      let device_height = device.height || 2248;
      let x = device_width / 2;
      let y = device_height * 0.85;
      console.log(`在(${x}, ${y})点击`);
      press(randomInt(x - 20, x + 20), randomInt(y - 20, y + 20), randomInt(100, 300));
    }
    sleep(randomInt(3000, 5000));

    // 判断 "继续编辑作品吗？" 弹窗 是否存在
    let continueEditBtn = waitForElement(text("继续编辑作品吗？"), 5000);
    if (continueEditBtn) {
      // 点击 取消 按钮
      let cancelBtn = waitForElement(desc("取消"), 1000);
      if (cancelBtn) {
        console.log("找到 取消 按钮，尝试点击...");
        safeClick(cancelBtn);
      }
    }
    sleep(randomInt(3000, 5000));

    // 等待主界面关键控件（首页按钮）出现，确认启动完成 (10秒超时)
    let homeBtn = waitForElement(text("首页"), 10000);
    if (!homeBtn) {
      throw new Error("未检测到 抖音 主界面");
    }
  },
  // 获取抖音当前用户信息
  getUserInfo() {
    verifyApp("获取抖音当前用户信息");
    console.info("获取抖音当前用户信息");
    // 点击 我 按钮
    let myBtn = waitForElement(text("我"), 1000);
    if (myBtn) {
      console.log("找到 我的 按钮，尝试点击...");
      axisClick(myBtn);
    } else {
      throw new Error("未找到可点击的 我的 按钮");
    }

    //
    // 1. 提取抖音号
    let dyIdNode = textStartsWith("抖音号：").findOne(3000);
    let dyId = dyIdNode.text().replace("抖音号：", "").trim();

    // 2. 通过抖音号向上查询用户名
    // 获取抖音号在屏幕上的坐标范围
    let dyBounds = dyIdNode.bounds();
    let parentNode = dyIdNode.parent();
    for (let i = 0; i < 4; i++) {
      if (parentNode && parentNode.parent()) {
        parentNode = parentNode.parent();
      }
    }
    // 在找到的共同祖先节点中，寻找所有的 TextView
    let textViews = parentNode.find(className("android.widget.TextView"));
    let dyName = null;
    // 遍历这些 TextView，找到在抖音号上方的那一个
    for (let i = 0; i < textViews.length; i++) {
      let node = textViews[i];
      let nodeBounds = node.bounds();
      let nodeText = node.text();
      if (nodeText && !nodeText.includes("抖音号：") && nodeBounds.bottom <= dyBounds.top) {
        dyName = nodeText;
        break; // 找到了最近的上方文本，退出循环
      }
    }

    return {
      dyId: dyId,
      dyName: dyName,
    };
  },

  // 获取视频信息
  getVideoInfo(userInfo) {
    console.info("获取视频信息");
    sleep(randomInt(1000, 5000));
    let nextRes = http.request(`${API_BASE_URL}/api/v1/autojs/next`, {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify({
        dyId: userInfo.dyId,
        dyName: userInfo.dyName,
      }),
    });
    let json = nextRes.body.json()
    let data = json.data
    if (data === null) {
      console.warn(`获取视频信息失败：${JSON.stringify(json)}`);
      return null
    }
    let videoInfo = {
      dyId: data.dyId,
      dyName: data.dyName,
      id: data.id,
      videoTitle: data.videoTitle,
      videoDesc: data.videoDescription,
      videoTag: data.videoTags,
      videoUrl: `https://wyts-content.oss-cn-wuhan-lr.aliyuncs.com/videos/${data.draftId}.mp4`,
      coverUrl: data.coverUrl,
    };

    return videoInfo;
  },

  // 清理相册(图片与视频)
  cleanupAlbum() {
    console.info("清理相册(图片与视频)");
    var cleanUpDir = "/sdcard/DCIM/douyin_release/";
    if (files.exists(cleanUpDir)) {
      console.log("相册存在");
      let result = files.removeDir(cleanUpDir);
      if (result) {
        console.log("相册已清理");
      } else {
        console.error("相册清理失败");
      }
    } else {
      console.log("相册不存在");
    }
  },

  // 下载封面
  downloadCover(coverUrl) {
    console.info("下载封面");
    // 保存到 DCIM 目录下的 douyin_release 文件夹中
    var saveDir = "/sdcard/DCIM/douyin_release/";
    // 创建文件夹
    files.create(saveDir);
    var coverExt = coverUrl.split(".")[coverUrl.split(".").length - 1];
    var savePath = saveDir + "cover_" + new Date().getTime() + "." + coverExt;

    var url = new java.net.URL(coverUrl);
    var connection = url.openConnection();
    connection.setConnectTimeout(60000);
    connection.setReadTimeout(120000);

    var inputStream = connection.getInputStream();
    var file = new java.io.File(savePath);
    var outputStream = new java.io.FileOutputStream(file);

    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    var bytesRead;
    while ((bytesRead = inputStream.read(buffer)) != -1) {
      outputStream.write(buffer, 0, bytesRead);
    }

    // 尝试关闭，如果失败就忽略
    try { outputStream.close(); } catch (e) { }
    try { inputStream.close(); } catch (e) { }

    media.scanFile(savePath);
    console.log("封面已保存：\n" + savePath);
  },

  // 下载视频
  downloadVideo(videoUrl) {
    console.info("下载视频");
    // 保存到 DCIM 目录下的 douyin_release 文件夹中
    var saveDir = "/sdcard/DCIM/douyin_release/";
    // 创建文件夹
    files.create(saveDir);
    var savePath = saveDir + "video_" + new Date().getTime() + ".mp4";

    var url = new java.net.URL(videoUrl);
    var connection = url.openConnection();
    connection.setConnectTimeout(60000);
    connection.setReadTimeout(120000);

    var inputStream = connection.getInputStream();
    var file = new java.io.File(savePath);
    var outputStream = new java.io.FileOutputStream(file);

    var buffer = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    var bytesRead;
    while ((bytesRead = inputStream.read(buffer)) != -1) {
      outputStream.write(buffer, 0, bytesRead);
    }

    // 尝试关闭，如果失败就忽略
    try { outputStream.close(); } catch (e) { }
    try { inputStream.close(); } catch (e) { }

    media.scanFile(savePath);
    console.log("视频已保存：\n" + savePath);
  },

  // 发布视频
  publishVideo(videoInfo) {
    verifyApp("发布视频");
    console.info("发布视频");

    // 点击 拍摄 按钮
    let captureBtn = waitForElement(desc("拍摄，按钮"), 10000);
    if (captureBtn) {
      console.log("找到 拍摄 按钮，尝试点击...");
      axisClick(captureBtn);
    } else {
      throw new Error("未找到可点击的拍摄按钮");
    }

    sleep(randomInt(3000, 5000));

    // 点击相册 按钮
    let albumBtn = waitForElement(desc("相册"), 10000);
    if (albumBtn) {
      console.log("找到 相册按钮，尝试点击...");
      axisClick(albumBtn);
    } else {
      throw new Error("未找到可点击的相册按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击所有照片 按钮
    let allPhotosBtn = waitForElement(text("所有照片"), 1000);
    if (allPhotosBtn) {
      console.log("找到 所有照片 按钮，尝试点击...");
      safeClick(allPhotosBtn);
    } else {
      throw new Error("未找到可点击的所有照片按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 douyin_release 按钮
    let douyinReleaseBtn = waitForElement(text("douyin_release"), 1000);
    if (douyinReleaseBtn) {
      console.log("找到 douyin_release 按钮，尝试点击...");
      safeClick(douyinReleaseBtn);
    } else {
      throw new Error("未找到可点击的 douyin_release 按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 第一个 视频
    let firstVideoBtn = waitForElement(id("root_view").clickable(true), 1000);
    if (firstVideoBtn) {
      console.log("找到 第一个视频 按钮，尝试点击...");
      safeClick(firstVideoBtn);
    } else {
      throw new Error("未找到可点击的第一视频按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 下一步 按钮
    let nextStepBtn = waitForElement(text("下一步"), 1000);
    if (nextStepBtn) {
      console.log("找到 下一步 按钮，尝试点击...");
      safeClick(nextStepBtn);
    } else {
      throw new Error("未找到可点击的下一步按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 下一步 按钮
    let nextStepBtn2 = waitForElement(text("下一步"), 1000);
    if (nextStepBtn2) {
      console.log("找到 下一步 按钮，尝试点击...");
      safeClick(nextStepBtn2);
    } else {
      throw new Error("未找到可点击的下一步按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 编辑封面
    let editCoverBtn = waitForElement(text("编辑封面"), 1000);
    if (editCoverBtn) {
      console.log("找到 编辑封面 按钮，尝试点击...");
      safeClick(editCoverBtn);
    } else {
      throw new Error("未找到可点击的编辑封面按钮");
    }
    sleep(randomInt(3000, 5000));

    // 判断 "封面诊断，让封面质量更优质" 弹窗 是否存在
    let coverDiagnosisBtn = waitForElement(text("封面诊断，让封面质量更优质"), 2000);
    if (coverDiagnosisBtn) {
      // 点击 关闭 按钮
      let closeBtn = waitForElement(desc("关闭"), 1000);
      if (closeBtn) {
        console.log("找到 关闭 按钮，尝试点击...");
        safeClick(closeBtn);
      }
      sleep(randomInt(3000, 5000));
    }
    sleep(randomInt(3000, 5000));

    // 点击相册
    let coverAlbumBtn = waitForElement(text("相册"), 10000);
    if (coverAlbumBtn) {
      console.log("找到 相册按钮，尝试点击...");
      axisClick(coverAlbumBtn);
    } else {
      throw new Error("未找到可点击的相册按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击所有照片 按钮
    let coverAllPhotosBtn = waitForElement(text("所有照片"), 1000);
    if (coverAllPhotosBtn) {
      console.log("找到 所有照片 按钮，尝试点击...");
      safeClick(coverAllPhotosBtn);
    } else {
      throw new Error("未找到可点击的所有照片按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 douyin_release 按钮
    let coverDouyinReleaseBtn = waitForElement(text("douyin_release"), 1000);
    if (coverDouyinReleaseBtn) {
      console.log("找到 douyin_release 按钮，尝试点击...");
      safeClick(coverDouyinReleaseBtn);
    } else {
      throw new Error("未找到可点击的 douyin_release 按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 第一个 照片
    let coverFirstPhotoBtn = waitForElement(id("root_view").clickable(true), 1000);
    if (coverFirstPhotoBtn) {
      console.log("找到 第一个照片 按钮，尝试点击...");
      safeClick(coverFirstPhotoBtn);
    } else {
      throw new Error("未找到可点击的第一照片按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 保存
    let coverSaveBtn = waitForElement(text("保存"), 1000);
    if (coverSaveBtn) {
      console.log("找到 保存 按钮，尝试点击...");
      safeClick(coverSaveBtn);
    } else {
      throw new Error("未找到可点击的保存按钮");
    }
    sleep(randomInt(3000, 5000));

    // 输入 标题
    let isTitleInput = false;
    let titleInput = waitForElement(text("添加标题"), 1000);
    if (titleInput) {
      isTitleInput = true;
      console.log("找到 标题 输入框，尝试输入...");
      titleInput.setText(videoInfo.videoTitle);
    }
    sleep(randomInt(3000, 5000));

    // 输入 描述 与 标签
    let descInput = waitForElement(text("添加作品描述.."), 1000);
    if (descInput) {
      console.log("找到 描述 输入框，尝试输入...");
      if (isTitleInput) {
        descInput.setText(`${videoInfo.videoDesc}\n\n${videoInfo.videoTag}`);
      } else {
        descInput.setText(`${videoInfo.videoTitle}\n\n${videoInfo.videoDesc}\n\n${videoInfo.videoTag}`);
      }
    } else {
      throw new Error("未找到可输入的描述输入框");
    }
    sleep(randomInt(3000, 5000));

    // 点击 发作品 按钮
    let publishBtn = waitForElement(text("发作品"), 1000);
    if (publishBtn) {
      console.log("找到 发作品 按钮，尝试点击...");
      safeClick(publishBtn);
    } else {
      throw new Error("未找到可点击的发作品按钮");
    }
    sleep(randomInt(3000, 5000));
    // 等待 发布完成
    while (true) {
      // 判断 com.ss.android.ugc.aweme:id/progress 是否存在 或 以% 结尾 的文本 是否存在
      let publishText = waitForElement(id("progress"), 500) || waitForElement(textEndsWith("%"), 500);
      if (publishText) {
        sleep(randomInt(3000, 5000));
      } else {
        console.log("发布完成");
        break;
      }
    }
    sleep(randomInt(3000, 5000));

    // 判断 "关于新的“朋友”功能" 弹窗 是否存在
    let aboutFriendBtn = waitForElement(text("关于新的“朋友”功能"), 2000);
    if (aboutFriendBtn) {
      // 点击 我知道了 按钮
      let knowBtn = waitForElement(text("我知道"), 1000);
      if (knowBtn) {
        console.log("找到 我知道了 按钮，尝试点击...");
        safeClick(knowBtn);
      }
    }
    sleep(randomInt(3000, 5000));
  },

  // 获取 发布成功 的视频连接
  getPublishedUrl() {
    verifyApp("获取发布成功视频连接");
    console.info("获取发布成功视频连接");
    // 点击 更多 按钮
    let moreBtn = waitForElement(text("更多"), 5000);
    if (moreBtn) {
      console.log("找到 更多 按钮，尝试点击...");
      safeClick(moreBtn);
    } else {
      throw new Error("未找到可点击的更多按钮");
    }
    sleep(randomInt(3000, 5000));

    // 点击 分享链接 按钮
    let shareBtn = waitForElement(text("分享链接"), 1000);
    if (shareBtn) {
      console.log("找到 分享链接 按钮，尝试点击...");
      safeClick(shareBtn);
    } else {
      throw new Error("未找到可点击的分享链接按钮");
    }
    sleep(randomInt(3000, 5000));

    // 获取 剪贴板 内容
    let clipText = getClipText();
    if (clipText) {
      console.log("剪贴板内容：" + clipText);
    } else {
      throw new Error("剪贴板内容为空");
    }
    sleep(randomInt(3000, 5000));

    // 提取 clipText 内 的 https://v.douyin.com/xx/ 格式的链接
    let publishUrl = clipText.match(/https:\/\/v\.douyin\.com\/[^/\s]+\/?/)[0];
    console.log("提取到的视频连接：" + publishUrl);
    // 访问 publishUrl 获取 重定向 后的 链接
    let errCount = 0;
    let redirectUrl;
    while (true) {
      if (errCount >= 5) {
        throw new Error("获取重定向后的视频连接失败，超过5次");
      }
      try {
        redirectUrl = String(http.get(publishUrl).url).split("?")[0];
        break;
      } catch (e) {
        errCount++;
        console.error("获取重定向后的视频连接失败：" + e);
        sleep(randomInt(3000, 5000));
        continue;
      }
    }
    if (!redirectUrl) {
      console.error("未获取到重定向后的视频连接：" + redirectUrl);
    }
    if (redirectUrl == "https://www.douyin.com/") {
      console.log("视频连接未重定向，直接返回");
      return publishUrl;
    }
    return redirectUrl;
  },

  // 更新视频状态为 已发布
  updateVideoStatusPublish(id, publishUrl) {
    console.info("更新视频状态为 已发布")
    let publishRes = http.request(`${API_BASE_URL}/api/v1/autojs/publish`, {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify({
        id: id,
        publishedVideoUrl: publishUrl,
      }),
    });
    console.log(publishRes.body.json());
  },
};

// --- 主控制流 ---
function main() {
  console.setTitle("抖音发布视频 运行中");

  while (true) {
    try {
      // 关闭抖音
      DouyinApp.kill();
      // 打开抖音
      DouyinApp.launch();
      // 获取抖音当前用户信息
      let userInfo = DouyinApp.getUserInfo();
      console.log("当前用户信息：" + JSON.stringify(userInfo));
      // 获取视频信息
      let videoInfo = DouyinApp.getVideoInfo(userInfo);
      if (!videoInfo) {
        return;
      }
      console.log("视频信息：" + JSON.stringify(videoInfo));
      // 清理相册(图片与视频)
      DouyinApp.cleanupAlbum();
      // 下载封面
      DouyinApp.downloadCover(videoInfo.coverUrl);
      // 下载视频
      DouyinApp.downloadVideo(videoInfo.videoUrl);
      // 发布视频
      DouyinApp.publishVideo(videoInfo);
      // 获取 发布成功 的视频连接
      let publishUrl = DouyinApp.getPublishedUrl();
      console.info(`发布成功，视频连接：${publishUrl}`);
      // 更新视频状态为 已发布
      DouyinApp.updateVideoStatusPublish(videoInfo.id, publishUrl);

      home();
      return
    } catch (e) {
      console.error("操作过程中出错：" + e);
      if (e.toString().includes("ScriptInterruptedException")) {
        console.info("脚本已停止");
        home();
        return;
      }
      return;
    }
  }

}



// 检查无障碍服务是否已经启用
auto();
// 开启控制台悬浮窗，方便查看运行日志
console.show();
console.clear()

if (app.versionCode !== 1) {
  // 申请悬浮窗权限
  auto.waitFor();
  // 创建固定悬浮窗
  let fw = floaty.window(
    <frame bg="#f44336" padding="12 6 12 6" radius="500">
      <text id="stop" text="停止" textColor="#fff" textSize="14sp" />
    </frame>
  );
  // 设置固定位置
  fw.setPosition(50, 120);
  // 点击停止脚本
  fw.stop.click(() => {
    toast("脚本已停止");
    fw.close();
    exit();
  });
}

// --- 日志配置 ---
let dirPath = "/sdcard/安卓群控/日志/";
// 确保目录存在，如果不存在则创建
if (!files.exists(dirPath)) {
  files.ensureDir(dirPath);
}
const now = new Date();
const datePart = now.toISOString().split('T')[0];
const timePart = now.toTimeString().split(' ')[0].replace(/:/g, "-");
console.setGlobalLogConfig({
  file: `${dirPath}抖音发布视频_${datePart}_${timePart}.log`,
});
console.log(`创建日志文件：${dirPath}抖音发布视频_${datePart}_${timePart}.log`);

main();
console.info("===结束===");
