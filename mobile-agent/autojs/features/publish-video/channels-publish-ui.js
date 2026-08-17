// 原中文名：视频号发布界面.js；职责：封装视频号发布界面交互。
function createWechatChannelsPublishUi(context) {
  var logger = context.logger;
  var packageName = "com.tencent.mm";

  function waitMs(value) {
    if (typeof sleep === "function") sleep(value);
  }

  function size() {
    return {
      width: typeof device !== "undefined" ? Number(device.width || 1080) : 1080,
      height: typeof device !== "undefined" ? Number(device.height || 2400) : 2400
    };
  }

  function findOne(selectors, timeoutMs) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var node = selectors[i].findOne(timeoutMs || 500);
        if (node) return node;
      } catch (error) {}
    }
    return null;
  }

  function clickNode(node, label) {
    if (!node) return false;
    var target = node;
    for (var i = 0; i < 4 && target; i++) {
      try {
        if (target.clickable && target.clickable() && target.click()) return true;
      } catch (error) {}
      target = target.parent && target.parent();
    }
    try {
      var bounds = node.bounds();
      click(bounds.centerX(), bounds.centerY());
      return true;
    } catch (error2) {
      logger.warn("视频号控件点击失败", { label: label, message: String(error2) });
      return false;
    }
  }

  function snapshot() {
    try {
      var value = context.screenRecognizer && context.screenRecognizer.extractFastText
        ? context.screenRecognizer.extractFastText()
        : null;
      if (value && typeof value === "object") return value;
      return { visibleText: String(value || "") };
    } catch (error) {
      return { visibleText: "", error: String(error) };
    }
  }

  function normalizeVisibleText(value) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (!value || typeof value !== "object") return "";
    var fields = ["combinedText", "visibleText", "text", "rawText", "screenText", "ocrText"];
    for (var i = 0; i < fields.length; i++) {
      var candidate = value[fields[i]];
      if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") {
        return String(candidate);
      }
    }
    return "";
  }

  var stateOcr = { at: 0, text: "" };
  function visibleText() { return normalizeVisibleText(snapshot()); }
  function stateText() {
    var textValue = visibleText();
    if (textValue) return textValue;
    var now = Date.now();
    if (!context.screenRecognizer || !context.screenRecognizer.extractScreen || now - stateOcr.at < 900) return stateOcr.text;
    stateOcr.at = now;
    try {
      var screenSize = size();
      var richSnapshot = context.screenRecognizer.extractScreen({ full: { x: 0, y: 0, w: screenSize.width, h: screenSize.height } });
      stateOcr.text = normalizeVisibleText(richSnapshot);
      if (richSnapshot && richSnapshot.image && richSnapshot.image.recycle) richSnapshot.image.recycle();
    } catch (error) { stateOcr.text = ""; }
    return stateOcr.text;
  }

  function selectedBottomTab() {
    var tabs = [
      { canonical: "信息", labels: ["信息", "微信"] },
      { canonical: "通讯录", labels: ["通讯录"] },
      { canonical: "发现", labels: ["发现"] },
      { canonical: "我", labels: ["我"] }
    ];
    var screen = size();
    for (var i = 0; i < tabs.length; i++) {
      for (var labelIndex = 0; labelIndex < tabs[i].labels.length; labelIndex++) {
        var label = tabs[i].labels[labelIndex];
        var node = findOne([
          descMatches("^" + label + ".*(已选中|选中).*$"),
          text(label)
        ], 180);
        if (!node) continue;
        try {
          var bounds = node.bounds();
          if (bounds.centerY() < screen.height * 0.72) continue;
          var target = node;
          for (var depth = 0; depth < 4 && target; depth++) {
            var description = String(target.desc && target.desc() || "");
            if ((target.selected && target.selected()) || /已选中|选中/.test(description)) return tabs[i].canonical;
            target = target.parent && target.parent();
          }
        } catch (error) {}
      }
    }
    var textValue = stateText();
    if (/微信(?:\(\d+\))?/.test(textValue) && /通讯录/.test(textValue) && /发现/.test(textValue) && /我/.test(textValue) && !/视频号|朋友圈|搜一搜/.test(textValue)) {
      if (logger && logger.info) logger.info("视频号微信底栏 OCR 回退识别", { bottomTab: "信息", visibleTextSample: textValue.slice(0, 160) });
      return "信息";
    }
    return "";
  }

  function inspectStartupState() {
    var foreground = false;
    try { foreground = currentPackage() === packageName; } catch (error) {}
    return { foreground: foreground, bottomTab: foreground ? selectedBottomTab() : "" };
  }

  function launchWechat() {
    if (!app.launchPackage(packageName)) throw new Error("微信启动失败");
    waitMs(1800);
  }

  function forceRestartWechat() {
    app.openAppSetting(packageName);
    waitMs(900);
    var stop = findOne([
      textMatches("^(强行停止|强制停止|结束运行)$"),
      descMatches("^(强行停止|强制停止|结束运行)$")
    ], 1500);
    if (!clickNode(stop, "强行停止微信")) throw new Error("未找到微信强行停止按钮");
    waitMs(400);
    var confirm = findOne([
      textMatches("^(确定|强行停止|强制停止)$"),
      descMatches("^(确定|强行停止|强制停止)$")
    ], 800);
    if (confirm) clickNode(confirm, "确认强行停止微信");
    waitMs(500);
    launchWechat();
  }

  function dismissVersionUpdateInvite() {
    var textValue = visibleText();
    if (!/新版本|内测邀请|立即安装|以后再说/.test(textValue)) return false;
    var later = findOne([
      textMatches("^(以后再说|暂不|取消)$"),
      descMatches("^(以后再说|暂不|取消)$")
    ], 700);
    if (!clickNode(later, "微信内测邀请以后再说")) return false;
    if (logger && logger.info) logger.info("微信新版本内测邀请已关闭", { visibleTextSample: textValue.slice(0, 160) });
    waitMs(450);
    return true;
  }

  function selectWechatHomeTab() {
    var home = findOne([text("微信"), desc("微信"), text("信息"), desc("信息")], 800);
    var clickedBySelector = clickNode(home, "微信首页底栏");
    if (!clickedBySelector) {
      var screen = size();
      click(Math.floor(screen.width * 0.125), Math.floor(screen.height * 0.9));
    }
    if (logger && logger.warn) logger.warn("视频号微信首页页签回退点击", { selectorMatched: !!home, clickedBySelector: clickedBySelector });
    waitMs(800);
  }
  function clickText(label, timeoutMs) {
    var node = findOne([
      text(label),
      desc(label),
      textContains(label),
      descContains(label)
    ], timeoutMs || 1000);
    if (!clickNode(node, label)) throw new Error("未找到" + label);
    waitMs(700);
  }

  function openDiscover() {
    var discover = findOne([text("发现"), desc("发现"), textContains("发现"), descContains("发现")], 1200);
    if (!clickNode(discover, "发现")) {
      var screen = size();
      click(Math.floor(screen.width * 0.625), Math.floor(screen.height * 0.9));
    }
    waitMs(700);
  }
  function openChannels() { clickText("视频号", 1600); }

  function openMine() {
    var mine = findOne([
      descMatches(".*(我的|个人中心|头像).*"),
      textMatches("^(我的|个人中心)$")
    ], 1000);
    if (!clickNode(mine, "视频号我的图标")) {
      var screen = size();
      click(Math.floor(screen.width * 0.92), Math.floor(screen.height * 0.07));
    }
    waitMs(800);
  }

  function openPublishVideo() {
    var entry = findOne([
      textMatches("^(发表视频|发布视频)$"),
      descMatches(".*(发表视频|发布视频|拍摄).*"),
      textMatches("^(发表|发布|\\+)$")
    ], 1200);
    if (!clickNode(entry, "发表视频入口")) {
      var screen = size();
      click(Math.floor(screen.width * 0.92), Math.floor(screen.height * 0.08));
      waitMs(500);
      clickText("发表视频", 1000);
    } else {
      var menu = findOne([textMatches("^(发表视频|从相册选择)$")], 500);
      if (menu) clickNode(menu, "发表视频");
    }
    waitMs(700);
  }

  function openAlbum() { clickText("相册", 1400); }

  function galleryTop() {
    var header = findOne([textMatches("^(最近|全部|视频|图片)$")], 250);
    try { return header.bounds().bottom + 8; } catch (error) {}
    return Math.floor(size().height * 0.18);
  }

  function readFirstGalleryItems() {
    var durations = ["", ""];
    var screen = size();
    var nodes;
    try { nodes = textMatches("^\\d{1,2}(?::\\d{2}){1,2}$|^\\d+$").find(); } catch (error) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      try {
        var bounds = nodes[i].bounds();
        if (bounds.centerY() > screen.height * 0.58) continue;
        var column = Math.floor(bounds.centerX() / (screen.width / 3));
        if (column >= 0 && column < 2 && !durations[column]) {
          durations[column] = String(nodes[i].text() || nodes[i].desc() || "");
        }
      } catch (error2) {}
    }
    return [{ durationText: durations[0] }, { durationText: durations[1] }];
  }

  function clickGalleryItem(index) {
    var screen = size();
    var cell = screen.width / 3;
    click(Math.floor(cell * index + cell * 0.5), Math.floor(galleryTop() + cell * 0.5));
    waitMs(700);
  }

  function clickNext() { clickText("下一步", 1500); }
  function addTitle() { clickText("添加标题", 1200); }

  function firstEditText() {
    try { return className("android.widget.EditText").findOne(1000); } catch (error) { return null; }
  }

  function inputTitle(value) {
    var node = firstEditText();
    try {
      if (node && node.setText) {
        node.setText(String(value || ""));
        waitMs(300);
        return;
      }
    } catch (error) {}
    throw new Error("视频号标题输入失败");
  }

  function confirmTitle() {
    var node = findOne([
      descMatches("^(完成|确定|对勾|保存)$"),
      textMatches("^(完成|确定|✓|√)$")
    ], 800);
    if (!clickNode(node, "标题对勾")) {
      var screen = size();
      click(Math.floor(screen.width * 0.92), Math.floor(screen.height * 0.07));
    }
    waitMs(300);
  }

  function tapOutsideTitle() {
    var screen = size();
    click(Math.floor(screen.width * 0.5), Math.floor(screen.height * 0.2));
    waitMs(250);
  }

  function completeTitle() { clickText("完成", 1200); }
  function openCoverSettings() { clickText("封面设置", 1500); } function chooseCoverFromAlbum() { clickText("从相册选择", 1500); }
  function clickCoverGalleryItem(index) { clickGalleryItem(Number(index || 0)); }
  function completeCoverSelection() { clickText("完成", 1200); } function completeCoverSettings() { clickText("完成", 1200); }
  function fillDescription(value) {
    var node = firstEditText();
    try {
      if (node && node.setText) {
        node.setText(String(value || ""));
        waitMs(350);
        return;
      }
    } catch (error) {}
    throw new Error("视频号描述输入失败");
  }

  function publish() { clickText("发表", 1400); }

  function waitForPublishOutcome(timeoutMs, verify) {
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (verify) verify();
      var textValue = visibleText();
      if (/发表成功|发布成功|已发表/.test(textValue)) return { success: true };
      if (Date.now() - startedAt > 7000 && /视频号|发现/.test(textValue) && !/添加描述|谁可以看|发表设置/.test(textValue)) {
        return { success: true };
      }
      waitMs(800);
    }
    return { success: false, reason: "视频号发表结果判定超时" };
  }

  function readPublishedResult() {
    var textValue = visibleText();
    var url = /(https?:\/\/[^\s]+)/.exec(textValue);
    var contentId = /(?:作品ID|feedId)[：:\s=]*([0-9A-Za-z_-]{6,})/.exec(textValue);
    return {
      publishedUrl: url ? url[1] : "",
      platformContentId: contentId ? contentId[1] : ""
    };
  }

  function has(pattern) { return pattern.test(stateText()); }

  return {
    inspectStartupState: inspectStartupState,
    launchWechat: launchWechat,
    forceRestartWechat: forceRestartWechat,
    selectWechatHomeTab: selectWechatHomeTab,
    dismissVersionUpdateInvite: dismissVersionUpdateInvite,
    snapshot: snapshot,
    openDiscover: openDiscover,
    openChannels: openChannels,
    openMine: openMine,
    openPublishVideo: openPublishVideo,
    openAlbum: openAlbum,
    readFirstGalleryItems: readFirstGalleryItems,
    clickGalleryItem: clickGalleryItem,
    clickNext: clickNext,
    addTitle: addTitle,
    inputTitle: inputTitle,
    confirmTitle: confirmTitle,
    tapOutsideTitle: tapOutsideTitle,
    completeTitle: completeTitle,
    openCoverSettings: openCoverSettings,
    chooseCoverFromAlbum: chooseCoverFromAlbum,
    clickCoverGalleryItem: clickCoverGalleryItem,
    completeCoverSelection: completeCoverSelection,
    completeCoverSettings: completeCoverSettings,
    fillDescription: fillDescription,
    publish: publish,
    waitForPublishOutcome: waitForPublishOutcome,
    readPublishedResult: readPublishedResult,
    states: {
      wechatHomeReady: function () { return inspectStartupState().bottomTab === "信息"; },
      discoverReady: function () { return has(/视频号|朋友圈|直播/); },
      channelsReady: function () { return has(/视频号/) && has(/关注|朋友|推荐|直播/); },
      mineReady: function () { return has(/我的视频号|作品|私密|动态|发表视频|发布视频/); },
      publishMenuReady: function () { return has(/发表视频|发布视频|从相册选择|拍摄/); },
      galleryReady: function () { return has(/最近|全部|视频|图片|所有照片|选择视频/); },
      nextReady: function () { return has(/下一步/); },
      titleReady: function () { return has(/轻触添加标题|添加标题/); },
      titleInputReady: function () { return !!firstEditText(); },
      exportStarted: function () { return has(/正在导出|导出中|合成中|封面设置|添加描述/); },
      exportComplete: function () { return !has(/正在导出|导出中|合成中/) && has(/封面设置|添加描述|谁可以看|发表/); },
      coverSourceReady: function () { return has(/封面设置|从相册选择|拍一张/); },
      coverGalleryReady: function () { return has(/最近|全部|图片|所有照片|选择封面/); },
      descriptionReady: function () { return has(/添加描述|更容易被推荐|谁可以看|发表/); },
      publishReady: function () { return has(/发表|谁可以看|添加描述/); }
    }
  };
}

module.exports = {
  createWechatChannelsPublishUi: createWechatChannelsPublishUi
};
