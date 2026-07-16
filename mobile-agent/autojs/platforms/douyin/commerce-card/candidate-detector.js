function isProductSignalText(value) {
  return /¥|￥|券后价|到手价|已售|销量|立减|优惠|包邮|发货|现货|进店|店铺|购物车|领券|水果|新鲜|现摘|斤|箱|应季|产地/.test(String(value || ""));
}

function isNonProductCardText(value) {
  return /相关搜索|大家都在搜|最近看过|评论\d*|相关推荐|关注|回复|首评|全屏观看|识别图片|#|@|发布时间|音乐|点赞|收藏|分享/.test(String(value || ""));
}

function isRelatedZoneText(value) {
  return /你可能|你可能想看|你可能还会喜欢|猜你喜欢|推荐商品|相关商品|同类好物|看了又看|还会买/.test(String(value || ""));
}

function isProductTitleLikeText(value) {
  value = String(value || "").replace(/\s+/g, "");
  if (value.length < 8) {
    return false;
  }
  if (isNonProductCardText(value)) {
    return false;
  }
  return /水果|新鲜|现摘|应季|产地|包邮|发货|现货|斤|箱|橙|柑|瓜|桃|梨|苹果|农家|基地|直发|采摘/.test(value);
}

function isRelatedCardBoundsAllowed(bounds, screen) {
  if (!bounds) {
    return false;
  }
  var centerY = bounds.centerY();
  if (centerY < screen.height * 0.28 || centerY > screen.height * 0.96) {
    return false;
  }
  if (bounds.width && (bounds.width() < screen.width * 0.16 || bounds.width() > screen.width * 0.96)) {
    return false;
  }
  if (bounds.height && (bounds.height() < 32 || bounds.height() > screen.height * 0.45)) {
    return false;
  }
  return true;
}

function scoreProductCardCandidate(bounds, screen, combinedText, depth, relatedZoneVisible) {
  var score = 10 + Math.max(0, Number(depth || 0));
  if (depth > 0) {
    score += 5;
  }
  if (/¥|￥|券后价|到手价|已售|销量/.test(combinedText)) {
    score += 12;
  }
  if (/水果|新鲜|现摘|应季|产地|包邮|发货|现货/.test(combinedText)) {
    score += 5;
  }
  if (relatedZoneVisible && isProductTitleLikeText(combinedText)) {
    score += 8;
  }
  if (bounds.width && bounds.width() > screen.width * 0.40) {
    score += 4;
  }
  if (bounds.height && bounds.height() >= 56) {
    score += 4;
  }
  if (bounds.centerY() > screen.height * 0.40) {
    score += 3;
  }
  return score;
}

function isRelatedProductListText(detailText, targetMatched, recommendationMatched) {
  if (!targetMatched) {
    return false;
  }
  if (recommendationMatched) {
    return true;
  }
  if (isRelatedZoneText(detailText)) {
    return true;
  }
  return false;
}

module.exports = {
  isProductSignalText: isProductSignalText,
  isNonProductCardText: isNonProductCardText,
  isRelatedZoneText: isRelatedZoneText,
  isProductTitleLikeText: isProductTitleLikeText,
  isRelatedCardBoundsAllowed: isRelatedCardBoundsAllowed,
  scoreProductCardCandidate: scoreProductCardCandidate,
  isRelatedProductListText: isRelatedProductListText
};
