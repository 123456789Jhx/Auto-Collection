module.exports = {
  app: {
    name: "燎原星火",
    version: "1.0.9"
  },

  device: {
    deviceId: "",
    deviceToken: ""
  },

  task: {
    taskId: "task_local_001",
    platform: "douyin",
    mode: "search",
    keywords: [
      "水稻病虫害",
      "水稻病虫灾害",
      "水稻虫害防治",
      "水稻纹枯病",
      "水稻稻飞虱",
      "玉米高产",
      "玉米病虫害",
      "玉米草地贪夜蛾",
      "小麦赤霉病",
      "小麦病虫害",
      "大棚蔬菜",
      "蔬菜病虫害",
      "果树修剪",
      "果树病虫害",
      "农业种植技术",
      "农作物病虫害",
      "农药使用技术",
      "大豆病虫害"
    ],
    maxVideos: 100,
    maxCaptures: 30,
    quickCheckSecondsMin: 0,
    quickCheckSecondsMax: 1,
    matchedStaySecondsMin: 8,
    matchedStaySecondsMax: 15,
    collectComments: true,
    commentLimit: 10,
    captureMode: "matched",
    saveScreenshots: false,
    liveMaxRoomsPerPhase: 5,
    liveCandidateMinScore: 55,
    liveLowStaySecondsMin: 120,
    liveLowStaySecondsMax: 300,
    liveNormalStaySecondsMin: 480,
    liveNormalStaySecondsMax: 900,
    liveHighStaySecondsMin: 1200,
    liveHighStaySecondsMax: 2100,
    liveReadonlyEnabled: true,
    liveReadonlySampleCount: 8,
    liveReadonlySampleIntervalMs: 1200,
    liveReadonlyMaxComments: 30,
    liveCommentDirectTest: false,
    liveCommentRole: "none",
    liveCommentGroup: "",
    liveCommentMode: "agri_chatbot",
    accountProfile: {
      profileName: "三农交流账号",
      region: { province: "", city: "", county: "" },
      identity: { role: "种植户", years: 5, tone: "朴实、自然、接地气" },
      products: [{ name: "水稻", scale: "几十亩", topics: ["病虫害", "水肥管理"] }],
      interests: ["三农", "种植", "农产品"],
      speakingStyle: { length: "short", emojiAllowed: false, questionRatio: 0.4 },
      forbiddenClaims: ["夸大收益", "保证效果", "诱导私信", "售卖农资"],
      status: "enabled"
    },
    liveCommentBotConfig: {
      enabled: true,
      botName: "三农聊天机器人",
      commentTypes: ["question", "agree", "experience_share", "knowledge_tip"],
      topicTags: ["水稻", "玉米", "蔬菜", "病虫害", "农机"],
      maxCommentsPerRoom: 3,
      maxCommentsPerHour: 10,
      minIntervalSeconds: 30,
      sendDelayMinMs: 800,
      sendDelayMaxMs: 1800,
      roomRelevanceThreshold: 1,
      lowConfidenceAction: "skip"
    },
    followedAccounts: [],
    liveComment: {
      enabled: true,
      executeEnabled: true,
      manualExecutionApproved: true,
      groupName: "A",
      leaderAccountNames: ["运营号A"],
      leaderAccountIds: [],
      triggerKeywords: ["1", "2", "是", "否"],
      replyPools: {
        A: ["1", "是"],
        B: ["2", "否"],
        C: ["收到", "说得对"]
      },
      sendDelayMinMs: 500,
      sendDelayMaxMs: 3000,
      perDeviceCooldownSeconds: 10,
      localCommentCacheSize: 200,
      maxConsecutiveSendFailures: 3,
      perTaskMaxComments: 60,
      lowConfidenceAction: "log_only"
    }
  },

  p3Extensions: {
    liveLike: {
      enabled: false,
      maxLikesPerLiveRoom: 0,
      minIntervalSeconds: 60,
      requireManualApproval: true
    },
    authorizedFollow: {
      enabled: false,
      requireEmployeeAuthorization: true,
      targetAccountId: "",
      targetAccountName: "",
      independentTaskOnly: true
    },
    linkage: {
      allowM1Input: false,
      allowM2Input: false,
      allowM3OutputToMaterialPool: false
    }
  },

  schedule: {
    enabled: true,
    videoMinutesMin: 120,
    videoMinutesMax: 180,
    liveMinutesMin: 60,
    liveMinutesMax: 120,
    autoStart: false
  },

  match: {
    agricultureKeywords: [
      "水稻",
      "玉米",
      "小麦",
      "大豆",
      "种植",
      "农民",
      "农村",
      "农业",
      "农田",
      "庄稼",
      "果树",
      "果园",
      "蔬菜",
      "菜地",
      "大棚",
      "育苗",
      "灌溉",
      "土壤",
      "施肥",
      "病虫害",
      "农药",
      "肥料",
      "除草剂",
      "农机",
      "收割机",
      "拖拉机",
      "养殖",
      "猪场",
      "牛羊",
      "鸡鸭",
      "饲料",
      "防疫",
      "疫苗",
      "兽药"
    ],
    marketingKeywords: ["招商", "加盟", "卖课", "收徒", "代理", "私信领取"],
    lowPriorityKeywords: ["娱乐", "明星", "八卦", "游戏", "搞笑"],
    liveKeywords: ["直播", "正在直播", "进入直播间", "直播中", "主播", "在线"]
  },

  output: {
    useProjectDir: true,
    folderName: "datasource",
    fixedBaseDir: "",
    baseDir: "",
    cacheDir: "",
    screenshotDir: "",
    logDir: "",
    xmlDir: "",
    writeLogFile: true,
    maxLogFileBytes: 3145728,
    repeatWarnLogIntervalMs: 300000
  },

  upload: {
    enabled: true,
    baseUrl: "http://106.54.41.106:18080/api/v1",
    url: "http://106.54.41.106:18080/api/v1/mobile/collection-records",
    registrationSecret: "",
    timeoutMs: 5000,
    retryCachedOnStart: true,
    controlEnabled: true,
    commandPollIntervalSeconds: 5,
    startupRetryFastMs: 10000,
    startupRetryMediumMs: 30000,
    startupRetrySlowMs: 60000,
    backendReadySyncIntervalMs: 300000,
    failureLogIntervalMs: 300000,
    requestStartLogIntervalMs: 300000,
    maxLogUploadBytes: 2097152,
    logUploadRecentDays: 7,
    dailyLogUploadHour: 23,
    dailyLogUploadMinute: 55,
    versionCheckEnabled: true,
    versionCheckIntervalMinutes: 2,
    versionChannel: "stable",
    deviceIdentityResetKey: ""
  },

  runtime: {
    ocrRetryCount: 3,
    recoverRetryCount: 2,
    searchEntryRetryCount: 3,
    launchFailurePauseThreshold: 3,
    searchFallbackToFeed: true,
    invalidContextRetryCount: 3,
    swipeDurationMs: 450,
    loopIntervalMs: 800,
    heartbeatMinutes: 1,
    idleHeartbeatSeconds: 60,
    agentIdleLoopMs: 1000,
    riskWords: [
      "验证码",
      "安全验证",
      "验证",
      "完成验证",
      "账号异常",
      "访问过于频繁",
      "稍后再试",
      "请旋转",
      "拖到下方",
      "拖动",
      "滑块",
      "符合上述描述",
      "请在下列图片",
      "账号存在风险"
    ]
  }
};
