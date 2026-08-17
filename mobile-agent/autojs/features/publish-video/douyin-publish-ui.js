// 原中文名：抖音发布界面.js；职责：封装抖音发布界面交互。
function createDouyinPublishUi(context) {
  var logger = context.logger;
  var packageName = "com.ss.android.ugc.aweme";
  function waitMs(value) { if (typeof sleep === "function") sleep(value); }
  function screenSize() {
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
      logger.warn("抖音发布控件点击失败", { label: label, message: String(error2) });
      return false;
    }
  }
  function normalizeVisibleText(value) {
    var valueType = typeof value;
    if (valueType === "string" || valueType === "number" || valueType === "boolean") {
      return String(value);
    }
    if (!value || valueType !== "object") return "";
    var textFields = ["combinedText", "visibleText", "text", "rawText", "screenText", "ocrText"];
    for (var index = 0; index < textFields.length; index++) {
      try {
        var textValue = value[textFields[index]];
        var textType = typeof textValue;
        if (textType === "string" || textType === "number" || textType === "boolean") {
          return String(textValue);
        }
      } catch (error) {}
    }
    return "";
  }
  function visibleText() {
    try {
      if (context.douyin && context.douyin.extractFastText) {
        var douyinText = normalizeVisibleText(context.douyin.extractFastText());
        if (douyinText) return douyinText;
      }
    } catch (error) {}
    try {
      if (context.screenRecognizer && context.screenRecognizer.extractFastText) {
        return normalizeVisibleText(context.screenRecognizer.extractFastText());
      }
    } catch (error2) {}
    return "";
  }
  function hasText(pattern) {
    return pattern.test(visibleText());
  }
  function findCameraAlbum(timeoutMs) {
    return findOne([
      textMatches("^(相册|从相册选择)$"),
      descMatches(".*(相册|从相册选择).*"),
      textContains("相册")
    ], timeoutMs || 500);
  }
  function findCameraTab(timeoutMs) {
    return findOne([
      textMatches("^(拍摄|相机)$"),
      textMatches("^\s*(拍摄|相机)\s*$"),
      descMatches(".*(拍摄|相机).*"),
      textContains("拍摄"),
      textContains("相机")
    ], timeoutMs || 500);
  }
  function selectedState(node) {
    try {
      if (node && typeof node.selected === "function") return !!node.selected();
    } catch (error) {}
    return null;
  }
  function cameraPageReady(timeoutMs) {
    return !!findCameraAlbum(timeoutMs || 500);
  }
  function waitForCameraPage(attempts) {
    for (var attempt = 0; attempt < attempts; attempt++) {
      if (cameraPageReady(500)) return true;
      if (attempt + 1 < attempts) waitMs(300);
    }
    return false;
  }
  function switchToCameraTab() {
    var cameraTab = findCameraTab(1000);
    return {
      found: !!cameraTab,
      selected: selectedState(cameraTab),
      clicked: clickNode(cameraTab, "拍摄/相机页签")
    };
  }
  function isDouyinForeground() {
    if (!context.douyin || !context.douyin.isForeground) return true;
    try { return context.douyin.isForeground(); } catch (error) { return false; }
  }
  function forceRestartDouyin(reason) {
    logger.warn("抖音启动后仍在其他窗口，尝试强制停止后重启", { reason: reason || "" });
    if (typeof app === "undefined" || !app.openAppSetting) throw new Error("抖音不在前台且无法打开应用信息页");
    app.openAppSetting(packageName);
    waitMs(900);
    var stop = findOne([textMatches("^(强行停止|强制停止|结束运行)$"), descMatches("^(强行停止|强制停止|结束运行)$")], 1500);
    if (!clickNode(stop, "强行停止抖音")) throw new Error("未找到抖音强行停止按钮");
    waitMs(400);
    var confirm = findOne([textMatches("^(确定|强行停止|强制停止)$"), descMatches("^(确定|强行停止|强制停止)$")], 800);
    if (confirm) clickNode(confirm, "确认强行停止抖音");
    waitMs(500);
    context.douyin.openApp();
    if (!isDouyinForeground()) throw new Error("抖音强制重启后仍未回到前台");
    logger.info("抖音强制重启完成", { reason: reason || "" });
  }
  function dismissBetaInvitation() {
    for (var attempt = 0; attempt < 3; attempt++) {
      if (!findOne([textMatches("^新版本内测邀请$")], 400)) { if (attempt < 2) waitMs(500); continue; }
      var later = findOne([textMatches("^以后再说$")], 800);
      if (!clickNode(later, "新版本内测邀请：以后再说")) throw new Error("未找到新版本内测邀请的以后再说按钮");
      logger.info("抖音新版本内测邀请已跳过"); return true;
    }
    return false;
  }
  function openApp() {
    if (!context.douyin || !context.douyin.openApp) throw new Error("未找到抖音打开动作");
    context.douyin.openApp();
    dismissBetaInvitation();
    if (!isDouyinForeground()) forceRestartDouyin("open_app_not_foreground");
    var staleText = visibleText(); if (/(?:选择(?:视频|照片|素材)|AI编辑封面|编辑封面|发布设置|作品描述|添加话题)|(?:相册.*下一步|下一步.*(?:相册|照片|视频))/.test(staleText)) { logger.warn("抖音仍停留在上次发布页面，已停止新任务", { visibleTextSample: staleText.slice(0, 160) }); throw new Error("DOUYIN_UNEXPECTED_PAGE: 抖音仍停留在上次发布页面，请手动返回首页后重新下发"); }
    return true;
  }
  function clickPublishEntry() {
    var entry = findOne([
      descMatches(".*(拍摄|发布作品|发布).*"),
      textMatches("^(拍摄|发布作品|发布|\\+)$")
    ], 1200);
    if (!clickNode(entry, "发布入口")) throw new Error("未找到发布入口");
    return true;
  }
  function openCamera() {
    openApp();
    var entry = findOne([
      descMatches(".*(拍摄|发布作品|发布).*"),
      textMatches("^(拍摄|发布作品|发布|\+)$")
    ], 1200);
    var entryClicked = clickNode(entry, "发布入口");
    if (!entryClicked) {
      var size = screenSize();
      click(Math.floor(size.width * 0.5), Math.floor(size.height * 0.94));
    }
    logger.info("抖音发布入口已点击", { selectorMatched: !!entry, clickedBySelector: entryClicked });
    waitMs(1000);
    if (waitForCameraPage(3)) {
      logger.info("抖音相机页已就绪", { recoveredFromLive: false });
      return true;
    }
    var switchResult = switchToCameraTab();
    logger.warn("抖音发布入口未进入相机页，尝试切换拍摄页签", {
      cameraTabFound: switchResult.found,
      cameraTabSelected: switchResult.selected,
      cameraTabClicked: switchResult.clicked
    });
    if (!switchResult.clicked) throw new Error("未找到拍摄/相机页签，无法从直播页切回相机页");
    if (!waitForCameraPage(4)) throw new Error("切换拍摄/相机页签后仍未进入相机页");
    logger.info("抖音相机页已就绪", { recoveredFromLive: true });
    return true;
  }
  function openAlbum() {
    var album = findCameraAlbum(1800);
    if (!clickNode(album, "相册")) throw new Error("未找到相册入口");
    waitMs(1000);
  }
  function galleryGridTop() {
    var header = findOne([textMatches("^(最近|全部|视频|图片)$")], 300);
    try { return header.bounds().bottom + 8; } catch (error) {}
    return Math.floor(screenSize().height * 0.18);
  }
  function galleryDurationByIndex() {
    var result = ["", ""];
    var size = screenSize();
    var nodes;
    try { nodes = textMatches("^\\d{1,2}(?::\\d{2}){1,2}$|^\\d+$").find(); } catch (error) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      try {
        var bounds = nodes[i].bounds();
        if (bounds.centerY() > size.height * 0.58) continue;
        var column = Math.floor(bounds.centerX() / (size.width / 3));
        if (column >= 0 && column < 2 && !result[column]) {
          result[column] = String(nodes[i].text() || nodes[i].desc() || "");
        }
      } catch (error2) {}
    }
    return result;
  }
  function readFirstGalleryItems() {
    var durations = galleryDurationByIndex();
    return [{ durationText: durations[0] }, { durationText: durations[1] }];
  }
  function clickGalleryItem(index, preferAccessibleItem) {
    if (preferAccessibleItem) {
      var accessibilityItem = findOne([descMatches(".*点按两次即可激活.*")], 500);
      if (accessibilityItem && clickNode(accessibilityItem, "封面相册第一项")) { waitMs(800); return; }
    }
    var size = screenSize();
    var cell = size.width / 3;
    var x = Math.floor(cell * index + cell * 0.5);
    var y = Math.floor(galleryGridTop() + cell * 0.5);
    click(x, y);
    waitMs(800);
  }
  function clickNextIfPresent(timeoutMs, silentIfMissing) {
    var waitTimeoutMs = Number(timeoutMs);
    if (!isFinite(waitTimeoutMs) || waitTimeoutMs < 0) waitTimeoutMs = 1000;
    var next = findOne([
      textMatches("^(下一步|完成|确认)$"),
      descMatches("^(下一步|完成|确认)$")
    ], waitTimeoutMs);
    if (!next) {
      if (!silentIfMissing) logger.warn("抖音发布下一步按钮未出现", { timeoutMs: waitTimeoutMs });
      return false;
    }
    if (!clickNode(next, "下一步")) return false;
    logger.info("抖音发布下一步已点击", { timeoutMs: waitTimeoutMs });
    waitMs(1000);
    return true;
  }
  function clickNext(timeoutMs) {
    if (!clickNextIfPresent(timeoutMs)) throw new Error("未找到下一步按钮");
    return true;
  }
  function openCoverAlbum() {
    var aiCover = findOne([
      textContains("AI编辑封面"),
      textMatches("^(AI编辑封面|编辑封面|设置封面|选封面|封面)$"),
      descMatches(".*(AI编辑封面|编辑封面|设置封面|选封面).*"),
      textContains("编辑封面"),
      textContains("选封面")
    ], 1600);
    if (!clickNode(aiCover, "封面编辑")) throw new Error("未找到封面编辑入口");
    waitMs(700);
    var album = findOne([
      textMatches("^(相册选图|从相册选择|相册)$"),
      descMatches(".*(相册选图|从相册选择).*"),
      textContains("相册选图")
    ], 1400);
    if (!clickNode(album, "相册选图")) throw new Error("未找到封面相册选图入口");
    waitMs(700);
  }
  function closeCoverDiagnostic() {
    if (!hasText(/封面诊断/)) return;
    var close = findOne([
      descMatches("^(关闭|close)$"),
      textMatches("^(关闭|×|x|X)$")
    ], 600);
    if (close) clickNode(close, "关闭封面诊断");
  }
  function saveCover() {
    var save = findOne([
      textMatches("^(保存|完成|确定)$"),
      descMatches("^(保存|完成|确定)$")
    ], 1200);
    if (!clickNode(save, "保存封面")) throw new Error("未找到封面保存按钮");
    waitMs(700);
  }
  function editableNodes() {
    try { return className("android.widget.EditText").find(); } catch (error) { return []; }
  }
  function setNodeText(node, value, label) {
    try {
      if (node && node.setText) {
        node.setText(String(value || ""));
        return;
      }
    } catch (error) {}
    throw new Error(label + "输入失败");
  }
  function fillTitleAndDescription(title, description) {
    var nodes = editableNodes();
    if (!nodes.length) throw new Error("未找到标题或描述输入框");
    if (nodes.length >= 2) {
      setNodeText(nodes[0], title, "标题");
      setNodeText(nodes[1], description, "描述");
    } else {
      setNodeText(nodes[0], [title, description].filter(Boolean).join("\n"), "标题描述");
    }
    waitMs(500);
  }
  function selectTopic(topic) {
    var escaped = String(topic || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var suggestion = findOne([
      textMatches("^#?" + escaped + ".*$"),
      descMatches("^#?" + escaped + ".*$")
    ], 500);
    if (suggestion) {
      clickNode(suggestion, "话题" + topic);
      waitMs(250);
      return true;
    }
    return false;
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
        if (value && !seen[value]) {
          seen[value] = true;
          result.push(value);
        }
      } catch (error2) {}
    }
    return result;
  }
  function confirmReview() {
    return !!findOne([
      textMatches("^(发布|立即发布|发作品)$"),
      descMatches("^(发布|立即发布|发作品)$")
    ], 1000);
  }
  function publish() {
    var publishNode = findOne([
      textMatches("^(发布|立即发布|发作品)$"),
      descMatches("^(发布|立即发布|发作品)$")
    ], 1200);
    if (!clickNode(publishNode, "发布")) throw new Error("未找到发布按钮");
  }
  function isPublishInProgress() { return hasText(/发布进度|正在发布|上传中/); }
  function waitForPublishSuccess(timeoutMs) {
    var startedAt = Date.now(), sawPublishing = false, stableHomeCount = 0;
    while (Date.now() - startedAt < timeoutMs) {
      var textValue = visibleText(), publishing = /发布进度|正在发布|上传中/.test(textValue);
      if (publishing) sawPublishing = true;
      if (/发布成功|作品发布成功|作品已发布/.test(textValue)) return true;
      var stableHome = sawPublishing && !publishing && /首页/.test(textValue) && /朋友|消息|我/.test(textValue) && !/立即发布|发布设置/.test(textValue);
      stableHomeCount = stableHome ? stableHomeCount + 1 : 0;
      if (stableHomeCount >= 3) return true;
      waitMs(800);
    }
    return false;
  }  function readPublishedResult() {
    var textValue = visibleText();
    var url = /(https?:\/\/[^\s]+)/.exec(textValue);
    var contentId = /(?:作品ID|video\/)[：:\s]*([0-9A-Za-z_-]{6,})/.exec(textValue);
    return {
      publishedUrl: url ? url[1] : "",
      platformContentId: contentId ? contentId[1] : ""
    };
  }
  return {
    openApp: openApp,
    clickPublishEntry: clickPublishEntry,
    openCamera: openCamera,
    openAlbum: openAlbum,
    readFirstGalleryItems: readFirstGalleryItems,
    clickGalleryItem: clickGalleryItem,
    clickNextIfPresent: clickNextIfPresent,
    clickNext: clickNext,
    openCoverAlbum: openCoverAlbum,
    closeCoverDiagnostic: closeCoverDiagnostic,
    saveCover: saveCover,
    fillTitleAndDescription: fillTitleAndDescription,
    selectTopic: selectTopic,
    listSelectedTopics: listSelectedTopics,
    confirmReview: confirmReview,
    publish: publish,
    isPublishInProgress: isPublishInProgress,
    waitForPublishSuccess: waitForPublishSuccess,
    readPublishedResult: readPublishedResult,
    states: {
      galleryReady: function () { return cameraPageReady(200) || hasText(/相册|拍摄|照片|视频/); },
      coverEditReady: function () { return hasText(/AI编辑封面|编辑封面|设置封面|选封面|封面/); },
      publishFormReady: function () { return hasText(/作品描述|添加话题|发布设置|标题/); },
      publishReviewReady: function () { return confirmReview(); }
    }
  };
}
module.exports = {
  createDouyinPublishUi: createDouyinPublishUi
};
