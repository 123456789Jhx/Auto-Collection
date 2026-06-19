function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function randomInt(min, max) {
  min = Math.floor(Number(min || 0));
  max = Math.floor(Number(max || min));
  if (max < min) max = min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function pickRandom(items) {
  items = items || [];
  if (!items.length) return "";
  return items[randomInt(0, items.length - 1)];
}

function defaultPools() {
  return {
    question: ["这个品种高温天咋管理？", "你们那边这季怎么控旺？", "这种情况先看苗情吗？"],
    agree: ["这个说法挺实在。", "确实，田间管理要看苗情。", "这点很多地块都能用上。"],
    experience_share: ["我们这边一般先看天气。", "这种还是要结合地块情况。", "水肥管理不能只按固定量。"],
    knowledge_tip: ["病虫害最好先分清类型。", "用肥还是要结合长势看。", "田里情况不一样，处理也要变。"]
  };
}

function createAgriCommentBotPlanner(options) {
  options = options || {};
  var safetyFilter = options.safetyFilter;
  var roomStats = {};
  var hourlyWindowStartedAt = Date.now();
  var hourlyCount = 0;

  function resetHourIfNeeded(nowMs) {
    if (nowMs - hourlyWindowStartedAt >= 60 * 60 * 1000) {
      hourlyWindowStartedAt = nowMs;
      hourlyCount = 0;
    }
  }

  function plan(input) {
    input = input || {};
    var botConfig = input.botConfig || {};
    var accountProfile = input.accountProfile || {};
    var roomName = input.roomName || "live_room";
    var nowMs = Date.now();
    resetHourIfNeeded(nowMs);

    if (botConfig.enabled === false) {
      return skipped(input, "bot_disabled");
    }
    if (!input.roomRelevance || input.roomRelevance.related !== true) {
      return skipped(input, "low_room_relevance");
    }

    var stats = roomStats[roomName] || { count: 0, lastAt: 0 };
    var maxPerRoom = Math.max(1, Number(botConfig.maxCommentsPerRoom || 3));
    var maxPerHour = Math.max(1, Number(botConfig.maxCommentsPerHour || 10));
    var minIntervalMs = Math.max(10, Number(botConfig.minIntervalSeconds || 120)) * 1000;
    if (stats.count >= maxPerRoom) {
      return skipped(input, "room_comment_limit");
    }
    if (hourlyCount >= maxPerHour) {
      return skipped(input, "hour_comment_limit");
    }
    if (stats.lastAt && nowMs - stats.lastAt < minIntervalMs) {
      return skipped(input, "comment_interval_limit");
    }

    var commentType = pickCommentType(botConfig);
    var replyText = buildReplyText(commentType, botConfig);
    var safety = safetyFilter && safetyFilter.check ? safetyFilter.check(replyText, {
      roomName: roomName,
      maxLength: botConfig.maxCommentLength || 40
    }) : { passed: true, reason: "" };
    if (!safety.passed) {
      return skipped(input, safety.reason || "safety_rejected", commentType, replyText, safety);
    }

    stats.count += 1;
    stats.lastAt = nowMs;
    roomStats[roomName] = stats;
    hourlyCount += 1;

    return buildAction(input, {
      status: "planned",
      commentType: commentType,
      replyText: replyText,
      skipReason: "",
      safety: safety,
      accountProfile: accountProfile,
      botConfig: botConfig
    });
  }

  function pickCommentType(botConfig) {
    var types = botConfig.commentTypes || ["question", "agree", "experience_share", "knowledge_tip"];
    return pickRandom(types) || "question";
  }

  function buildReplyText(commentType, botConfig) {
    var pools = botConfig.templatePools || defaultPools();
    var pool = pools[commentType] || defaultPools()[commentType] || defaultPools().question;
    return normalizeText(pickRandom(pool));
  }

  function skipped(input, reason, commentType, replyText, safety) {
    var fallbackText = reason ? "[跳过] " + reason : "[跳过]";
    return buildAction(input, {
      status: "skipped",
      commentType: commentType || "",
      replyText: replyText || fallbackText,
      skipReason: reason,
      safety: safety || { passed: false, reason: reason },
      accountProfile: input.accountProfile || {},
      botConfig: input.botConfig || {}
    });
  }

  function buildAction(input, options) {
    var relevance = input.roomRelevance || {};
    var botConfig = options.botConfig || {};
    var profile = options.accountProfile || {};
    var roomName = input.roomName || "";
    var eventId = [
      input.taskId || "",
      input.deviceId || "",
      "agri_chatbot",
      roomName || "room",
      Date.now()
    ].join(":");
    var delayMin = Number(botConfig.sendDelayMinMs || 3000);
    var delayMax = Math.max(delayMin, Number(botConfig.sendDelayMaxMs || 12000));
    return {
      type: "agri_chatbot_plan",
      taskId: input.taskId || "",
      deviceId: input.deviceId || "",
      platform: input.platform || "douyin",
      triggerEventId: eventId,
      triggerText: normalizeText(input.textSample || "").slice(0, 200),
      leaderAccountName: botConfig.botName || profile.profileName || "三农聊天机器人",
      roomName: roomName,
      matchedKeywords: relevance.matchedKeywords || [],
      replyText: options.replyText || "",
      plannedDelayMs: options.status === "planned" ? randomInt(delayMin, delayMax) : 0,
      status: options.status,
      skipReason: options.skipReason || "",
      failureReason: "",
      plannedAt: new Date().toISOString(),
      rawPayload: {
        mode: "agri_chatbot",
        botName: botConfig.botName || "",
        profileName: profile.profileName || "",
        commentType: options.commentType || "",
        roomRelevance: relevance,
        safety: options.safety || {},
        accountProfile: profile
      }
    };
  }

  return {
    plan: plan,
    getState: function () {
      return {
        hourlyCount: hourlyCount,
        hourlyWindowStartedAt: new Date(hourlyWindowStartedAt).toISOString()
      };
    }
  };
}

module.exports = {
  createAgriCommentBotPlanner: createAgriCommentBotPlanner
};
