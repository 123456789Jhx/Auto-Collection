// 原中文名：素材判断.js；职责：检查并选择可发布素材。
function normalizeDuration(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function hasVideoDuration(value) {
  var duration = normalizeDuration(value);
  return /^\d{1,2}(?::\d{2}){1,2}$/.test(duration) || /^\d+$/.test(duration);
}

function chooseVideoMaterial(items) {
  var candidates = Object.prototype.toString.call(items) === "[object Array]" ? items : [];
  for (var index = 0; index < Math.min(2, candidates.length); index++) {
    var durationText = normalizeDuration(candidates[index] && candidates[index].durationText);
    if (hasVideoDuration(durationText)) {
      return { valid: true, index: index, durationText: durationText };
    }
  }
  return { valid: false, index: -1, reason: "素材未正确上传" };
}

module.exports = {
  hasVideoDuration: hasVideoDuration,
  chooseVideoMaterial: chooseVideoMaterial
};
