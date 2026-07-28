function createDouyinPublishUi(context) {
  var logger = context.logger;

  function waitMs(value) {
    if (typeof sleep === "function") sleep(value);
  }

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

  function visibleText() {
    try {
      if (context.douyin && context.douyin.extractFastText) {
        return String(context.douyin.extractFastText() || "");
      }
      if (context.screenRecognizer && context.screenRecognizer.extractFastText) {
        return String(context.screenRecognizer.extractFastText() || "");
      }
    } catch (error) {}
    return "";
  }

  function hasText(pattern) {
    return pattern.test(visibleText());
  }

  function openCamera() {
    context.douyin.openApp();
    var entry = findOne([
      descMatches(".*(拍摄|发布作品|发布).*"),
      textMatches("^(拍摄|发布作品|发布|\\+)$")
    ], 1200);
    if (!clickNode(entry, "发布入口")) {
      var size = screenSize();
      click(Math.floor(size.width * 0.5), Math.floor(size.height * 0.94));
    }
    waitMs(1000);
    return true;
  }

  function openAlbum() {
    var album = findOne([
      textMatches("^(相册|从相册选择)$"),
      descMatches(".*(相册|从相册选择).*"),
      textContains("相册")
    ], 1800);
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

  function clickGalleryItem(index) {
    var size = screenSize();
    var cell = size.width / 3;
    var x = Math.floor(cell * index + cell * 0.5);
    var y = Math.floor(galleryGridTop() + cell * 0.5);
    click(x, y);
    waitMs(800);
  }

  function clickNextIfPresent() {
    var next = findOne([
      textMatches("^(下一步|完成|确认)$"),
      descMatches("^(下一步|完成|确认)$")
    ], 1000);
    if (next) {
      clickNode(next, "下一步");
      waitMs(1000);
    }
  }

  function openCoverAlbum() {
    var aiCover = findOne([
      textContains("AI编辑封面"),
      textMatches("^(编辑封面|设置封面)$"),
      descContains("编辑封面")
    ], 1600);
    if (!clickNode(aiCover, "AI编辑封面")) throw new Error("未找到AI编辑封面入口");
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
      textMatches("^(发布|立即发布)$"),
      descMatches("^(发布|立即发布)$")
    ], 1000);
  }

  function publish() {
    var publishNode = findOne([
      textMatches("^(发布|立即发布)$"),
      descMatches("^(发布|立即发布)$")
    ], 1200);
    if (!clickNode(publishNode, "发布")) throw new Error("未找到发布按钮");
  }

  function waitForPublishSuccess(timeoutMs) {
    var startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      var textValue = visibleText();
      if (/发布成功|作品发布成功|已发布/.test(textValue)) return true;
      if (Date.now() - startedAt > 6000 && /首页|朋友|消息|我/.test(textValue) && !/立即发布|发布设置/.test(textValue)) {
        return true;
      }
      waitMs(800);
    }
    return false;
  }

  function readPublishedResult() {
    var textValue = visibleText();
    var url = /(https?:\/\/[^\s]+)/.exec(textValue);
    var contentId = /(?:作品ID|video\/)[：:\s]*([0-9A-Za-z_-]{6,})/.exec(textValue);
    return {
      publishedUrl: url ? url[1] : "",
      platformContentId: contentId ? contentId[1] : ""
    };
  }

  return {
    openCamera: openCamera,
    openAlbum: openAlbum,
    readFirstGalleryItems: readFirstGalleryItems,
    clickGalleryItem: clickGalleryItem,
    clickNextIfPresent: clickNextIfPresent,
    openCoverAlbum: openCoverAlbum,
    closeCoverDiagnostic: closeCoverDiagnostic,
    saveCover: saveCover,
    fillTitleAndDescription: fillTitleAndDescription,
    selectTopic: selectTopic,
    listSelectedTopics: listSelectedTopics,
    confirmReview: confirmReview,
    publish: publish,
    waitForPublishSuccess: waitForPublishSuccess,
    readPublishedResult: readPublishedResult,
    states: {
      galleryReady: function () { return hasText(/相册|拍摄|照片|视频/); },
      coverEditReady: function () { return hasText(/AI编辑封面|编辑封面|下一步/); },
      publishFormReady: function () { return hasText(/作品描述|添加话题|发布设置|标题/); },
      publishReviewReady: function () { return confirmReview(); }
    }
  };
}

module.exports = {
  createDouyinPublishUi: createDouyinPublishUi
};
