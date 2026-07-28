function snapshotText(snapshot) {
  if (!snapshot) return "";
  return String(snapshot.combinedText || snapshot.visibleText || snapshot.text || "");
}

function markChannelsVerificationPopup(snapshot, stage) {
  var text = snapshotText(snapshot);
  var definitions = [
    { label: "安全验证", pattern: /安全验证|完成验证后继续|请先验证/ },
    { label: "拖动滑块", pattern: /拖动滑块|滑块拼图|完成拼图/ },
    { label: "验证码", pattern: /输入验证码|获取验证码|验证码/ },
    { label: "身份验证", pattern: /验证身份|身份核验|实名验证/ },
    { label: "操作异常", pattern: /操作异常|环境异常|账号异常/ }
  ];
  var markers = [];
  for (var i = 0; i < definitions.length; i++) {
    if (definitions[i].pattern.test(text)) markers.push(definitions[i].label);
  }
  if (!markers.length) return { detected: false, status: "READY", feature: null };
  return {
    detected: true,
    status: "CHANNELS_VERIFY_PENDING",
    feature: {
      stage: String(stage || "未知步骤"),
      markers: markers,
      packageName: String(snapshot && snapshot.currentPackageName || ""),
      activityName: String(snapshot && snapshot.currentActivityName || ""),
      textSample: text.replace(/\s+/g, " ").trim().slice(0, 180)
    }
  };
}

function createChannelsVerificationError(marked) {
  var feature = marked && marked.feature || {};
  var message = "检测到视频号额外验证弹窗：" + (feature.markers || []).join("、") +
    "；步骤=" + String(feature.stage || "未知步骤") +
    "；特征=" + String(feature.textSample || "");
  var error = new Error(message);
  error.publishStatus = "CHANNELS_VERIFY_PENDING";
  error.popupFeature = feature;
  return error;
}

module.exports = {
  createChannelsVerificationError: createChannelsVerificationError,
  markChannelsVerificationPopup: markChannelsVerificationPopup
};
