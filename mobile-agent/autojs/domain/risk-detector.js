function containsRisk(config, text) {
  var source = String(text || "");
  if (!source) {
    return false;
  }

  var strongPatterns = [
    /验证码|安全验证|完成验证|请完成验证/,
    /账号异常|账号存在风险|账号安全/,
    /访问过于频繁|操作过于频繁|请求过于频繁|稍后再试/,
    /请旋转|拖到下方|拖动滑块|滑块验证|请在下列图片|符合上述描述/
  ];
  for (var i = 0; i < strongPatterns.length; i++) {
    if (strongPatterns[i].test(source)) {
      return true;
    }
  }

  var riskWords = config.runtime.riskWords || [];
  for (var j = 0; j < riskWords.length; j++) {
    var word = riskWords[j];
    if (!word || word === "风险" || word === "验证") {
      continue;
    }
    if (source.indexOf(word) >= 0) {
      return true;
    }
  }

  return false;
}

function isInvalidTaskContext(text) {
  var source = String(text || "");
  if (!source) {
    return false;
  }
  var strongInvalidWords = [
    "支付成功",
    "确认支付",
    "提交订单",
    "订单详情",
    "收银台",
    "视频同款这里下单",
    "商品评价",
    "加入购物车",
    "立即购买",
    "确认订单",
    "发布作品",
    "选择音乐",
    "分段拍",
    "照片",
    "相机",
    "开直播",
    "创作灵感",
    "灵感跟拍",
    "倒计时",
    "闪光灯",
    "翻转",
    "编辑资料",
    "账号与安全",
    "设置与隐私"
  ];
  for (var i = 0; i < strongInvalidWords.length; i++) {
    if (source.indexOf(strongInvalidWords[i]) >= 0) {
      return true;
    }
  }

  return isPublishContext(source) || isSearchContext(source);
}

function isPublishContext(text) {
  if (!hasStandaloneLine(text, "下一步") && !hasStandaloneLine(text, "发布")) {
    return false;
  }
  return /选择音乐|分段拍|照片|相机|开直播|创作灵感|倒计时|闪光灯|翻转|发布作品/.test(text);
}

function isSearchContext(text) {
  if (!/相关搜索|筛选/.test(text) && !/搜索/.test(text)) {
    return false;
  }
  var tabWords = ["综合", "视频", "用户", "直播", "图文", "店铺", "团购"];
  var hitCount = 0;
  for (var i = 0; i < tabWords.length; i++) {
    if (hasStandaloneLine(text, tabWords[i])) {
      hitCount += 1;
    }
  }
  return hitCount >= 3;
}

function hasStandaloneLine(text, word) {
  var lines = String(text || "").split(/\n+/);
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].replace(/\s+/g, "") === word) {
      return true;
    }
  }
  return false;
}

module.exports = {
  containsRisk: containsRisk,
  isInvalidTaskContext: isInvalidTaskContext
};
