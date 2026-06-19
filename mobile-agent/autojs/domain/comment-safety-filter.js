function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createCommentSafetyFilter(options) {
  options = options || {};
  var bannedWords = options.bannedWords || [
    "私信", "加微信", "微信", "联系方式", "代理", "招商", "加盟", "卖课", "保证增产", "包治", "稳赚", "暴富"
  ];
  var recentTexts = {};

  function check(text, meta) {
    text = normalizeText(text);
    meta = meta || {};
    if (!text || text.length < 4) {
      return { passed: false, reason: "too_short" };
    }
    if (text.length > Number(meta.maxLength || 40)) {
      return { passed: false, reason: "too_long" };
    }
    for (var i = 0; i < bannedWords.length; i++) {
      if (text.indexOf(bannedWords[i]) >= 0) {
        return { passed: false, reason: "banned_word", bannedWord: bannedWords[i] };
      }
    }
    var roomKey = meta.roomName || "default_room";
    var key = roomKey + "|" + text;
    if (recentTexts[key]) {
      return { passed: false, reason: "duplicate_in_room" };
    }
    recentTexts[key] = Date.now();
    return { passed: true, reason: "" };
  }

  return {
    check: check
  };
}

module.exports = {
  createCommentSafetyFilter: createCommentSafetyFilter
};
