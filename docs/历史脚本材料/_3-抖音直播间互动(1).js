/**
 * 名称：抖音直播间互动
 * 运行环境：Auto.js
 * 适配应用：抖音
 * 版本：1.0.0
 * 更新时间：2026.04.02 12:01
 * 功能描述：观看抖音直播间，点赞、评论、回复评论(根据关键词)
 * 注意事项：
 * 1. 请确保抖音已登录，且账号有足够的权限进行操作。
 * 2. 脚本运行时，请勿操作抖音界面，以免干扰脚本执行。
 */

/**
 * 抖音直播间互动:
 * 0、关闭抖音
 * 1、打开抖音
 * 2、首页点直播tab
 * 3、上划直播(切换直播间)[直到直播用户名称在目标内]
 * 4、点击用户头像(进入用户主页)
 * 5、判断抖音号是否是目标用户，返回上一页[是:继续操作;否:返回3]
 * 6、进入直播间
 * 7、双击3-5次(点赞)
 * 8、简单评论，随机打数字或者表情
 * 9、等待评论区的关键词(等待期间，一直点赞)
 * 10、根据关键词回复评论[回到9]
 *
 * 检测到直播结束，关闭抖音
 */


// --- 全局配置 ---
const CONFIG = {
  likeCountMin: 3, // 双击点赞最小次数
  likeCountMax: 5, // 双击点赞最大次数
};


// --- 评论配置 ---
const DATA = {
  commentLits: ["111", "666", "👍", "🌹", "😊"], // 简单评论：随机数字或表情

  // 目播用户互动配置
  duoyingUser: [
    // 用户名            用户抖音号
    { name: "天道直播", id: "45782013369" }
  ],

  // 评论互动配置
  duoyingComment: [
    // 评论关键词     评论内容              评论间隔时间(秒)
    { keyword: "123", comment: ["1", "2"], interval: 60 * 3 }
  ]
};


// 随机数函数
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机数函数(包含小数)
function random(min, max, precision = 2) {
  return Number((Math.random() * (max - min) + min).toFixed(precision));
}

// 随机选择一个评论
function randomComment() {
  return DATA.commentLits[randomInt(0, DATA.commentLits.length - 1)];
}

// 格式化剩余时间
function formatRemainingTime(remainingTime) {
  // 确保剩余时间为非负数
  remainingTime = Math.max(0, remainingTime);

  // 修复：正确计算 小时、分钟、秒、毫秒
  const hour = 1000 * 60 * 60;
  const minute = 1000 * 60;
  const second = 1000;

  let remainingHours = Math.floor(remainingTime / hour);
  let remainingMinutes = Math.floor((remainingTime % hour) / minute);
  let remainingSeconds = Math.floor((remainingTime % minute) / second);
  let remainingMilliseconds = remainingTime % second;

  let remaining = '';
  if (remainingHours > 0) {
    remaining += `${remainingHours}h `;
  }
  if (remainingMinutes > 0) {
    remaining += `${remainingMinutes}m `;
  }
  if (remainingSeconds > 0) {
    remaining += `${remainingSeconds}s `;
  }
  if (remainingMilliseconds > 0) {
    remaining += `${remainingMilliseconds}ms`;
  }
  // 修复：无剩余时间时显示 0s
  return remaining || '0s';
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
  let nullCount = 0;
  while (currentPkg == null && nullCount < 3) {
    currentPkg = getCurrentPackage();
    sleep(randomInt(2000, 3000));
    nullCount++;
  }
  if (currentPkg == null) {
    toast("获取当前应用包名失败(获取为null)，跳过校验...");
  }
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
  let device_width = device.width || 1080;
  let device_height = device.height || 2248;
  x = Math.max(0, Math.min(x, device_width));
  y = Math.max(0, Math.min(y, device_height));

  // 随机按压时间
  let pressTime = randomInt(100, 150);
  console.log(`坐标点击：(${x}, ${y}) 时长：${pressTime}ms`);

  press(x, y, pressTime);
  sleep(randomInt(500, 1000));
  return true;
}

// 查找所有可见控件（包括子控件）
function findAllVisibleNodes() {
  let list = [];
  let selectors = [
    className("android.view.View"),
    className("android.widget.FrameLayout"),
    className("android.widget.LinearLayout"),
    className("android.widget.RelativeLayout"),
    className("android.widget.ImageView"),
    className("android.widget.TextView")
  ];

  for (let sel of selectors) {
    let nodes = sel.visibleToUser(true).find();
    for (let n of nodes) list.push(n);
  }
  return list;
}

// 判断直播是否已结束
function isLiveEnded() {
  try {
    // 查找 描述为 "直播已结束" 的控件
    let endNode = desc("直播已结束").visibleToUser(true).findOne(300);

    // 如果找到 并且 在屏幕内可见
    if (endNode && endNode.bounds() && endNode.visibleToUser()) {
      return true;
    }
  } catch (e) {
    // 不崩溃
  }
  return false;
}

// 获取 屏幕中间 ~ 弹幕上方 的空白区域
function getMiddleToLiveBlankPoint() {
  let w = device.width || 1080;
  let h = device.height || 2248;

  // --------------------------
  // 核心区域（抖音直播间标准布局）
  // --------------------------
  let SCREEN_MIDDLE = h * 0.45;      // 屏幕中间偏上（起点）
  let DANMU_TOP = h * 0.65;          // 弹幕区最顶部（终点）

  // 获取所有可见控件
  let allNodes = findAllVisibleNodes();

  // 收集所有占用区域
  let occupied = [];
  for (let node of allNodes) {
    let b = node.bounds();
    if (!b || b.width() <= 2 || b.height() <= 2) continue;

    // 只收集我们关心的区间内的控件
    if (b.bottom > SCREEN_MIDDLE && b.top < DANMU_TOP) {
      occupied.push(b);
    }
  }

  // --------------------------
  // 从 弹幕上方 往 屏幕中间 扫描，找空白 Y
  // --------------------------
  let safeY = -1;
  let startY = DANMU_TOP - 80;   // 从弹幕顶部往上 80px 开始
  let endY = SCREEN_MIDDLE + 40; // 到屏幕中间偏上

  for (let y = startY; y >= endY; y -= 6) {
    let isBlank = true;
    for (let r of occupied) {
      if (y >= r.top - 10 && y <= r.bottom + 10) {
        isBlank = false;
        break;
      }
    }
    if (isBlank) {
      safeY = y;
      break;
    }
  }

  // 兜底安全位置（绝对不会错）
  if (safeY === -1) {
    safeY = h * 0.50; // 屏幕正中间
  }

  // X 居中 + 小偏移
  let safeX = w / 2 + randomInt(-8, 8);

  return {
    x: Math.floor(safeX),
    y: Math.floor(safeY)
  };
}

// 判断直播用户是否在目标内
function isLiveUserInTarget() {
  try {
    // 查找 直播用户名称 控件
    // 构造正则：匹配任意一个目标用户名
    const userName = new RegExp(
      ".*(" +
      DATA.duoyingUser.map(u => u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') +
      ").*"
    );
    let liveUserNode = textMatches(userName).visibleToUser(true).findOne(3000);

    // 如果找到 并且 在屏幕内可见
    if (liveUserNode && liveUserNode.bounds() && liveUserNode.visibleToUser()) {
      console.log("直播用户名匹配");
      // 点击 直播用户名称 控件
      axisClick(liveUserNode);
      sleep(randomInt(2000, 3000));

      // 获取 抖音号 控件
      let isFound = false; // 是否找到抖音号控件
      let douyinIdNode = textStartsWith("抖音号").visibleToUser(true).findOne(3000);
      if (douyinIdNode && douyinIdNode.bounds() && douyinIdNode.visibleToUser()) {
        console.log("抖音号控件找到");
        let douyinId = douyinIdNode.text().trim();
        console.log("抖音号:", douyinId.replace("抖音号：", ""));
        // 检查抖音号是否与目标用户匹配
        let isMatch = DATA.duoyingUser.some(u => u.id === douyinId.replace("抖音号：", ""));
        if (isMatch) {
          console.log("抖音号与目标用户匹配");
          isFound = true;
        } else {
          console.log("抖音号与目标用户不匹配");
        }
      } else {
        console.log("未找到抖音号控件，尝试点击 更多(...) 按钮");
        let moreNode = desc("更多").visibleToUser(true).findOne(3000);
        if (moreNode && moreNode.bounds() && moreNode.visibleToUser()) {
          console.log("更多控件找到");
          safeClick(moreNode);
          sleep(randomInt(1000, 2000));
          // 获取 抖音号 控件
          let douyinIdNode2 = textStartsWith("抖音号").visibleToUser(true).findOne(3000);
          if (douyinIdNode2 && douyinIdNode2.bounds() && douyinIdNode2.visibleToUser()) {
            console.log("抖音号控件找到");
            let douyinId2 = douyinIdNode2.text().trim();
            console.log("抖音号:", douyinId2.replace("抖音号：", ""));
            // 检查抖音号是否与目标用户匹配
            let isMatch2 = DATA.duoyingUser.some(u => u.id === douyinId2.replace("抖音号：", ""));
            if (isMatch2) {
              console.log("抖音号与目标用户匹配");
              isFound = true;
            } else {
              console.log("抖音号与目标用户不匹配");
            }
          }

          // 关闭 更多
          let moreNode = desc("关闭").visibleToUser(true).findOne(3000);
          if (moreNode && moreNode.bounds() && moreNode.visibleToUser()) {
            console.log("关闭控件找到");
            safeClick(moreNode);
            sleep(1000);
          } else {
            console.log("未找到关闭控件");
            // 点击 系统 返回 上一页
            back();
          }
        }
      }

      // 获取 返回 控件
      let returnNode = desc("返回").findOne(3000);
      if (returnNode && returnNode.bounds() && returnNode.visibleToUser()) {
        console.log("返回控件找到");
        safeClick(returnNode);
        sleep(1000);
      } else {
        console.log("未找到返回控件");
        // 点击 系统 返回 上一页
        back();
      }

      return isFound;
    }

  } catch (e) {
    // 不崩溃
  }
  return false;
}

// --- 核心业务逻辑 ---
const DouyinApp = {
  // 强制关闭抖音
  kill() {
    console.info("0. 关闭抖音");
    // 打开应用设置
    app.openAppSetting(app.getPackageName("抖音") || "com.ss.android.ugc.aweme");
    // 等待 2-3 秒，确保设置界面加载完成
    sleep(randomInt(2000, 3000));

    // 查找并点击 强制停止 按钮
    let stopBtn = waitForElement(textMatches(/.*(强行停止|强制停止|结束运行|Force stop).*/), 3000) ||
      waitForElement(descMatches(/.*(强行停止|强制停止|结束运行|Force stop).*/), 3000);

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
    console.info("1. 打开抖音");
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

  // 首页点直播tab
  switchToLiveTab() {
    // 判断 "添加「直播」到手机桌面" 是否存在
    let addLiveBtn = waitForElement(text("添加「直播」到手机桌面"), 5000);
    if (addLiveBtn) {
      // 点击 不感兴趣
      let notInterestedBtn = waitForElement(text("不感兴趣"), 1000);
      if (notInterestedBtn) {
        console.log("找到 不感兴趣 按钮，尝试点击...");
        safeClick(notInterestedBtn);
      }
    }

    verifyApp("准备点击直播Tab");
    console.info(`2. 首页点直播tab`);
    // 点击直播Tab
    let liveTab = waitForElement(text("直播"), 5000);
    if (!liveTab) {
      throw new Error("未检测到 直播Tab");
    }
    // 点击直播Tab
    safeClick(liveTab);
    // 随机等待 10-15 秒，模拟人类操作间隔
    sleep(randomInt(10000, 15000));

    // 判断 "添加「直播」到手机桌面" 是否存在
    let addLiveBtn2 = waitForElement(text("添加「直播」到手机桌面"), 5000);
    if (addLiveBtn2) {
      // 点击 不感兴趣
      let notInterestedBtn = waitForElement(text("不感兴趣"), 1000);
      if (notInterestedBtn) {
        console.log("找到 不感兴趣 按钮，尝试点击...");
        safeClick(notInterestedBtn);
      }
    }

    // 判断 发现更多 按钮 是否可见
    while (true) {
      let moreBtn = waitForElement(textMatches(/.*(发现更多|直播发现).*/), 1000);
      if (!(moreBtn && moreBtn.bounds() && moreBtn.visibleToUser())) {
        console.log("未找到发现更多按钮，尝试点击");
        // 获取屏幕下方的空白区域
        let device_width = device.width || 1080;
        let device_height = device.height || 2248;
        let x = device_width / 2;
        let y = device_height * 0.85;
        console.log(`在(${x}, ${y})点击`);
        press(randomInt(x - 20, x + 20), randomInt(y - 20, y + 20), randomInt(100, 300));
        // 随机等待 2-3 秒，模拟人类操作间隔
        sleep(randomInt(2000, 3000));
      } else {
        console.log("发现更多按钮找到");
        break;
      }
      sleep(randomInt(2000, 3000));
    }
  },

  // 检查直播用户是否在目标内
  checkLiveUser() {
    verifyApp("准备检查直播用户");
    console.info(`3-5. 检查直播用户是否在目标内`);
    while (true) {
      // 判断 当前 是否在 首页 内
      let isHome = waitForElement(text("首页"), 3000);
      if (!isHome) {
        console.log("当前不在首页");
        let closeBtn = desc("关闭").clickable(true).visibleToUser(true).findOne(3000);
        if (closeBtn && closeBtn.bounds() && closeBtn.visibleToUser()) {
          console.log("关闭控件找到");
          safeClick(closeBtn);
        }
        continue;
      }
      if (isLiveUserInTarget()) {
        break;
      }
      // 获取屏幕下方的空白区域
      let device_width = device.width || 1080;
      let device_height = device.height || 2248;
      let p1 = { x: device_width / 2, y: device_height * 0.85 };
      let p2 = { x: p1.x - randomInt(-20, 20), y: p1.y - randomInt(550, 650) };
      toast(`${p1.x}, ${p1.y} -> ${p2.x}, ${p2.y}`);
      // 上划(进入下一个直播间)
      swipe(p1.x, p1.y, p2.x, p2.y, randomInt(500, 600));

      // 随机等待 1-2 秒，模拟人类操作间隔
      sleep(randomInt(1000, 2000));
    }
  },

  // 进入直播间
  enterLiveRoom() {
    verifyApp("准备进入直播间");
    console.info(`6. 进入直播间`);
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));
    // 获取屏幕下方的空白区域
    let device_width = device.width || 1080;
    let device_height = device.height || 2248;
    let p = { x: device_width / 2, y: device_height * 0.85 };
    console.log(`在(${p.x}, ${p.y})点击`);
    press(randomInt(p.x - 20, p.x + 20), randomInt(p.y - 20, p.y + 20), randomInt(100, 300));
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));

    // 获取屏幕下方的空白区域
    let p2 = { x: device_width / 2, y: device_height * 0.85 };
    console.log(`在(${p2.x}, ${p2.y})点击`);
    press(randomInt(p2.x - 20, p2.x + 20), randomInt(p2.y - 20, p2.y + 20), randomInt(100, 300));
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));
  },

  // 直播间内互动 (点赞、评论)
  interactInLiveRoom() {
    verifyApp("准备互动直播间");
    console.info(`7. 双击3-5次(点赞)`);
    // 直播已结束，不点赞
    if (isLiveEnded()) {
      console.log("直播已结束，不点赞");
      return;
    }
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));
    // 获取屏幕下方的空白区域
    let likeCount = randomInt(CONFIG.likeCountMin, CONFIG.likeCountMax);
    let p = getMiddleToLiveBlankPoint();
    console.log(`在(${p.x}, ${p.y})双击点赞 ${likeCount} 次`);
    // 双击点赞
    for (let j = 0; j < likeCount; j++) {
      // 双击点赞（模拟真人操作，带随机间隔）
      press(randomInt(p.x - 20, p.x + 20), randomInt(p.y - 20, p.y + 20), randomInt(100, 300));
      sleep(randomInt(50, 150));
      press(randomInt(p.x - 20, p.x + 20), randomInt(p.y - 20, p.y + 20), randomInt(100, 300));
      sleep(randomInt(600, 1200));
    }
    sleep(randomInt(2000, 3000));

    console.info(`8. 简单评论，随机打数字或者表情`);
    // 直播已结束，不评论
    if (isLiveEnded()) {
      console.log("直播已结束，不评论");
      return;
    }
    // 等待评论框出现
    let commentBox = waitForElement(className("android.widget.EditText"), 5000);
    if (!commentBox) {
      throw new Error("未检测到 评论框");
    }
    safeClick(commentBox);
    // 输入评论
    let comment = randomComment();
    console.log(`输入评论: ${comment}`);
    setText(comment);
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));
    // 点击发送按钮
    let sendBtn = waitForElement(text("发送"), 5000);
    if (!sendBtn) {
      throw new Error("未检测到 发送按钮");
    }
    safeClick(sendBtn);
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));
  },

  // 等待评论区的关键词(等待期间，一直点赞)，根据关键词回复评论
  waitForCommentAndReply() {
    verifyApp("准备等待评论区的关键词(等待期间，一直点赞)，根据关键词回复评论");
    console.info(`9-10. 等待评论区的关键词(等待期间，一直点赞)，根据关键词回复评论`);

    // 直播未结束，等待评论区的关键词
    let noCommentSection = 0;
    // 上次回复 关键词与时间
    let lastReply = [];
    while (!isLiveEnded()) {
      // 判断 "免流量看视频"(广告) 或 "玩转抖音星卡"(广告) 或 "不感兴趣"(直播间长按弹窗) 或 "USB 用于" 是否存在
      let freeVideoBtn = textMatches(/.*(免流量看视频|玩转抖音星卡|不感兴趣|USB 用于).*/).findOne(1000);
      if (freeVideoBtn) {
        // 点击 系统 返回 上一页
        back();
        sleep(1000);
        continue;
      }

      verifyApp("");
      let commentSection = className("androidx.recyclerview.widget.RecyclerView")
        .scrollable(true)
        .findOne(5000);

      if (!commentSection) {
        noCommentSection++;
        console.log("未检测到 评论区");
        if (noCommentSection > 5) {
          throw new Error("评论区未检测到关键词，5次未检测到 评论区");
        }
        continue;
      }
      noCommentSection = 0;
      let comments = [];

      // 不使用ID，直接取 TextView
      let texts = commentSection.find(className("android.widget.TextView"));
      for (let i = 0; i < texts.length; i++) {
        let t = texts[i].text().trim();
        if (t) {
          comments.push(t);
        }
      }

      for (let comment of comments) {
        // 1. 获取所有关键词
        let keywords = DATA.duoyingComment.map(item => item.keyword);
        // 2. 判断是否以 ：关键词 结尾（精准匹配）
        let matchKey = keywords.some(keyword => comment.endsWith(`：${keyword}`));
        if (matchKey) {
          // 3. 找到【匹配到的那个关键词】
          let hitKeyword = keywords.find(k => comment.endsWith(`：${k}`));
          // 4. 找到对应的回复内容
          let target = DATA.duoyingComment.find(item => item.keyword === hitKeyword);
          // 5. 随机选择一个回复内容
          let replyComment = target.comment[randomInt(0, target.comment.length - 1)];
          // 输出日志
          console.log(`✅ ${comment}，命中关键词: ${hitKeyword}`);
          // 6. 检查是否需要回复
          let lastReplyObj = lastReply.find(item => item.keyword === hitKeyword);
          let lastReplyTime = lastReplyObj ? lastReplyObj.time : null;
          let now = Date.now();
          let interval = target.interval * 1000; // 配置中单位是秒，需要转换为毫秒
          // 7. 检查是否需要回复
          if (lastReplyTime && now - lastReplyTime < interval) {
            toast(`❌ 间隔时间未到，不回复，关键词: ${hitKeyword}`);
            continue;
          }
          // 8. 记录回复时间
          if (!lastReplyObj) {
            lastReply.push({ keyword: hitKeyword, time: now });
          } else {
            lastReplyObj.time = now;
          }

          if (replyComment) {
            console.log(`💬 自动回复: ${replyComment}`);

            // 等待评论框出现
            let commentBox = waitForElement(className("android.widget.EditText"), 5000);
            if (!commentBox) {
              toast("未检测到 评论框");
              continue;
            }
            safeClick(commentBox);
            // 输入评论
            console.log(`输入评论: ${replyComment}`);
            setText(replyComment);
            // 随机等待 2-3 秒，模拟人类操作间隔
            sleep(randomInt(2000, 3000));
            // 点击发送按钮
            let sendBtn = waitForElement(text("发送"), 5000);
            if (!sendBtn) {
              toast("未检测到 发送按钮");
              continue;
            }
            safeClick(sendBtn);
            // 随机等待 2-3 秒，模拟人类操作间隔
            sleep(randomInt(2000, 3000));
            toast("回复成功");
            break;
          }
        }
      }
      // ==================
      // 点赞
      // ==================
      let p = getMiddleToLiveBlankPoint();
      toast(`在(${p.x}, ${p.y})双击点赞`);
      // 双击点赞（模拟真人操作，带随机间隔）
      press(randomInt(p.x - 20, p.x + 20), randomInt(p.y - 20, p.y + 20), randomInt(100, 300));
      sleep(randomInt(50, 150));
      press(randomInt(p.x - 20, p.x + 20), randomInt(p.y - 20, p.y + 20), randomInt(100, 300));
      sleep(randomInt(1500, 3500));
    }
  },

  // 退出直播间并清理环境
  exitAndCleanup() {
    verifyApp("准备退出直播间");
    console.info(`7. 关闭直播间`);
    // 点击返回按钮
    let backBtn = waitForElement(desc("关闭").visibleToUser(true), 5000);
    if (!backBtn) {
      throw new Error("未检测到 关闭按钮");
    }
    safeClick(backBtn);
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));

    home();
    // 随机等待 2-3 秒，模拟人类操作间隔
    sleep(randomInt(2000, 3000));

    // 结束脚本
    exit();
  },
};

// --- 主控制流 ---
function main() {
  console.setTitle("抖音直播间互动 运行中");

  while (true) {
    try {
      // 0.关闭抖音
      DouyinApp.kill();
      // 1.打开抖音
      DouyinApp.launch();
      // 2.切换到直播Tab
      DouyinApp.switchToLiveTab();

      // 3-5.判断抖音号是否是目标用户
      // 3.上划直播(切换直播间)[直到直播用户名称在目标内]
      // 4.判断直播用户是否在目标内
      // 5.判断抖音号是否是目标用户，返回上一页[是:继续操作;否:返回3]
      DouyinApp.checkLiveUser();

      // 6.进入直播间
      DouyinApp.enterLiveRoom();

      // 7-8.互动直播间 (点赞、评论)
      DouyinApp.interactInLiveRoom();

      // 9-10 等待评论区的关键词(等待期间，一直点赞)，根据关键词回复评论
      DouyinApp.waitForCommentAndReply();

      // 退出直播间并清理环境
      DouyinApp.exitAndCleanup();
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
  file: `${dirPath}抖音直播间互动_${datePart}_${timePart}.log`,
});
console.log(`创建日志文件：${dirPath}抖音直播间互动_${datePart}_${timePart}.log`);

main();
console.info("===结束===");
