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

  function visibleText() {
    var value = snapshot();
    return String(value.combinedText || value.visibleText || "");
  }

  function selectedBottomTab() {
    var labels = ["信息", "通讯录", "发现", "我"];
    var screen = size();
    for (var i = 0; i < labels.length; i++) {
      var node = findOne([
        descMatches("^" + labels[i] + ".*(已选中|选中).*$"),
        text(labels[i])
      ], 180);
      if (!node) continue;
      try {
        var bounds = node.bounds();
        if (bounds.centerY() < screen.height * 0.72) continue;
        var target = node;
        for (var depth = 0; depth < 4 && target; depth++) {
          var description = String(target.desc && target.desc() || "");
          if ((target.selected && target.selected()) || /已选中|选中/.test(description)) return labels[i];
          target = target.parent && target.parent();
        }
      } catch (error) {}
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

  function openDiscover() { clickText("发现", 1200); }
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

  function selectTopic(topic) {
    var escaped = String(topic || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var node = findOne([
      textMatches("^#?" + escaped + ".*$"),
      descMatches("^#?" + escaped + ".*$")
    ], 450);
    if (!node) return false;
    clickNode(node, "话题" + topic);
    waitMs(220);
    return true;
  }

  function listSelectedTopics() {
    var result = [];
    var seen = {};
    var nodes;
    try { nodes = textMatches("^#.+").find(); } catch (error) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      try {
        if (String(nodes[i].className() || "").indexOf("EditText") >= 0) continue;
        var value = String(nodes[i].text() || nodes[i].desc() || "").replace(/^#/, "").trim();
        if (value && !seen[value]) { seen[value] = true; result.push(value); }
      } catch (error2) {}
    }
    return result;
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

  function has(pattern) { return pattern.test(visibleText()); }

  return {
    inspectStartupState: inspectStartupState,
    launchWechat: launchWechat,
    forceRestartWechat: forceRestartWechat,
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
    fillDescription: fillDescription,
    selectTopic: selectTopic,
    listSelectedTopics: listSelectedTopics,
    publish: publish,
    waitForPublishOutcome: waitForPublishOutcome,
    readPublishedResult: readPublishedResult,
    states: {
      discoverReady: function () { return inspectStartupState().bottomTab === "信息"; },
      channelsReady: function () { return has(/视频号/); },
      mineReady: function () { return has(/视频号|关注|朋友|推荐/); },
      publishMenuReady: function () { return has(/发表视频|发布视频|从相册选择/); },
      albumReady: function () { return has(/相册|从相册选择/); },
      titleReady: function () { return has(/添加标题|下一步|编辑/); },
      exportComplete: function () { return !has(/正在导出|导出中|合成中/) && has(/添加描述|谁可以看|发表/); },
      publishReady: function () { return has(/发表|谁可以看|添加描述/); }
    }
  };
}

module.exports = {
  createWechatChannelsPublishUi: createWechatChannelsPublishUi
};
