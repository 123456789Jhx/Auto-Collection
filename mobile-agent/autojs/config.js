module.exports = {
  app: {
    name: "AgriVideoCollector",
    version: "0.1.0"
  },

  device: {
    deviceId: "android_001"
  },

  task: {
    taskId: "task_local_001",
    platform: "douyin",
    mode: "feed", // feed | search
    keywords: [
      "水稻病虫害",
      "玉米高产",
      "小麦赤霉病",
      "大棚蔬菜",
      "果树修剪"
    ],
    maxVideos: 100,
    maxCaptures: 30,
    staySecondsMin: 5,
    staySecondsMax: 12,
    collectComments: true,
    commentLimit: 10,
    captureMode: "all", // matched | all，调试期建议 all，避免漏采
    saveScreenshots: false
  },

  schedule: {
    enabled: true,
    videoMinutesPerDay: 120,
    liveMinutesPerDay: 60,
    autoStart: false
  },

  match: {
    agricultureKeywords: [
      "水稻",
      "玉米",
      "小麦",
      "大豆",
      "果树",
      "蔬菜",
      "大棚",
      "育苗",
      "灌溉",
      "土壤",
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
    lowPriorityKeywords: ["娱乐", "明星", "八卦", "游戏", "搞笑"]
  },

  output: {
    useProjectDir: true,
    folderName: "datasource",
    fixedBaseDir: "/storage/emulated/0/安卓群控/autojs/datasource",
    baseDir: "",
    cacheDir: "",
    screenshotDir: "",
    logDir: "",
    xmlDir: "",
    writeLogFile: true
  },

  upload: {
    enabled: false,
    url: "http://127.0.0.1:8080/api/mobile/video-captures",
    timeoutMs: 15000,
    retryCachedOnStart: true
  },

  runtime: {
    ocrRetryCount: 3,
    recoverRetryCount: 2,
    swipeDurationMs: 450,
    loopIntervalMs: 800,
    riskWords: ["验证码", "安全验证", "登录", "账号异常", "访问过于频繁", "稍后再试"]
  }
};
