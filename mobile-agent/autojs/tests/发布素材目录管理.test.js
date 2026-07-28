const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createPublishMaterialManager } = require("../domain/素材目录管理.js");
const { createPublishTaskLock } = require("../domain/发布任务锁.js");

function normalize(path) {
  var value = String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
  return value.length > 1 ? value.replace(/\/$/, "") : value;
}

function parentOf(path) {
  var normalized = normalize(path);
  var index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function createMemoryFiles() {
  var directories = new Set(["/", "/sdcard"]);
  var fileValues = new Map();

  function ensureDir(path) {
    var normalized = normalize(path);
    if (directories.has(normalized)) return;
    ensureDir(parentOf(normalized));
    directories.add(normalized);
  }

  function addFile(path, bytes) {
    var normalized = normalize(path);
    ensureDir(parentOf(normalized));
    fileValues.set(normalized, bytes || Buffer.from("seed"));
  }

  function directNames(dir) {
    var normalized = normalize(dir);
    var prefix = normalized === "/" ? "/" : normalized + "/";
    var names = new Set();
    directories.forEach(function (path) {
      if (path.indexOf(prefix) !== 0 || path === normalized) return;
      var rest = path.slice(prefix.length);
      if (rest && rest.indexOf("/") < 0) names.add(rest);
    });
    fileValues.forEach(function (_, path) {
      if (path.indexOf(prefix) !== 0) return;
      var rest = path.slice(prefix.length);
      if (rest && rest.indexOf("/") < 0) names.add(rest);
    });
    return Array.from(names).sort();
  }

  return {
    addDir(path) { ensureDir(path); },
    addFile,
    exists(path) {
      var normalized = normalize(path);
      return directories.has(normalized) || fileValues.has(normalized);
    },
    isDir(path) { return directories.has(normalize(path)); },
    listDir(path) { return directNames(path); },
    createWithDirs(path) { addFile(path, Buffer.alloc(0)); return true; },
    writeBytes(path, bytes) { addFile(path, Buffer.from(bytes)); },
    remove(path) { return fileValues.delete(normalize(path)); },
    removeDir(path) {
      var normalized = normalize(path);
      var prefix = normalized + "/";
      Array.from(fileValues.keys()).forEach(function (value) {
        if (value === normalized || value.indexOf(prefix) === 0) fileValues.delete(value);
      });
      Array.from(directories).forEach(function (value) {
        if (value === normalized || value.indexOf(prefix) === 0) directories.delete(value);
      });
      return true;
    }
  };
}

function createStorage(values) {
  values = values || {};
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    },
    put(key, value) { values[key] = value; },
    remove(key) { delete values[key]; }
  };
}

function fixedDate() {
  return new Date(2026, 6, 28, 10, 30, 0);
}

test("素材目录序号跨实例持久化且使用全角括号", () => {
  var memoryFiles = createMemoryFiles();
  var storage = createStorage();
  var dependencies = {
    files: memoryFiles,
    storage,
    now: fixedDate,
    logger: { warn() {} }
  };
  var firstManager = createPublishMaterialManager(dependencies);
  var first = firstManager.beginTask({}, {});
  var restartedManager = createPublishMaterialManager(dependencies);
  var second = restartedManager.beginTask({}, {});

  assert.equal(first.dir, "/sdcard/20260728");
  assert.equal(first.videoPath, "/sdcard/20260728/video.mp4");
  assert.equal(first.coverPath, "/sdcard/20260728/cover.jpg");
  assert.equal(second.dir, "/sdcard/20260728（1）");
  assert.equal(memoryFiles.exists(second.dir + "/.keep"), true);
});

test("素材根目录按 payload、配置、默认值依次解析", () => {
  var manager = createPublishMaterialManager({
    files: createMemoryFiles(),
    storage: createStorage(),
    now: fixedDate,
    logger: { warn() {} }
  });

  assert.equal(manager.resolveRoot({ downloadDir: " /payload-root " }, {
    publishMaterialRoot: "/config-root"
  }), "/payload-root");
  assert.equal(manager.resolveRoot({ downloadDir: "" }, {
    publishMaterialRoot: "/config-root"
  }), "/config-root");
  assert.equal(manager.resolveRoot({}, {}), "/sdcard/");
});

test("清理历史目录时混入非白名单文件会保护性跳过", () => {
  var memoryFiles = createMemoryFiles();
  var warnings = [];
  memoryFiles.addFile("/sdcard/20260726/video.mp4");
  memoryFiles.addFile("/sdcard/20260726/cover.jpg");
  memoryFiles.addFile("/sdcard/20260727（2）/video.mov");
  memoryFiles.addFile("/sdcard/20260727（2）/用户照片.jpg");
  memoryFiles.addFile("/sdcard/普通相册/video.mp4");
  var manager = createPublishMaterialManager({
    files: memoryFiles,
    storage: createStorage(),
    now: fixedDate,
    logger: { warn(message, details) { warnings.push({ message, details }); } }
  });

  assert.deepEqual(manager.sweepStale("/sdcard"), ["/sdcard/20260726"]);
  assert.equal(memoryFiles.exists("/sdcard/20260726"), false);
  assert.equal(memoryFiles.exists("/sdcard/20260727（2）"), true);
  assert.equal(memoryFiles.exists("/sdcard/普通相册"), true);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /跳过素材目录清理/);
});

test("缺少视频或封面时返回精确中文错误且不发起下载", () => {
  var requestCount = 0;
  var manager = createPublishMaterialManager({
    files: createMemoryFiles(),
    storage: createStorage(),
    now: fixedDate,
    http: { get() { requestCount += 1; throw new Error("不应下载"); } },
    media: { scanFile() {} },
    logger: { warn() {} }
  });
  var paths = { dir: "/sdcard/20260728", videoPath: "/sdcard/20260728/video.mp4", coverPath: "/sdcard/20260728/cover.jpg" };

  assert.throws(
    () => manager.download(paths, { videoUrl: "", coverUrl: "https://example.test/cover.jpg" }),
    (error) => error.message === "缺少视频素材：接口 videoUrl 为空"
  );
  assert.throws(
    () => manager.download(paths, { videoUrl: "https://example.test/video.mp4", coverUrl: null }),
    (error) => error.message === "缺少封面素材：接口 coverUrl 为空"
  );
  assert.equal(requestCount, 0);
});

test("视频和封面落盘后立即扫描且任务结束删除整个目录", () => {
  var memoryFiles = createMemoryFiles();
  var scans = [];
  var urls = [];
  var manager = createPublishMaterialManager({
    files: memoryFiles,
    storage: createStorage(),
    now: fixedDate,
    http: {
      get(url) {
        urls.push(url);
        return { statusCode: 200, body: { bytes() { return Buffer.from(url); } } };
      }
    },
    media: { scanFile(path) { scans.push(path); } },
    logger: { warn() {} }
  });
  var paths = manager.beginTask({ downloadDir: "/sdcard" }, {});

  assert.deepEqual(manager.download(paths, {
    videoUrl: "https://example.test/video.mp4",
    coverUrl: "https://example.test/cover.jpg"
  }), paths);
  assert.deepEqual(urls, ["https://example.test/video.mp4", "https://example.test/cover.jpg"]);
  assert.deepEqual(scans, [paths.videoPath, paths.coverPath]);
  assert.equal(memoryFiles.exists(paths.videoPath), true);
  assert.equal(memoryFiles.exists(paths.coverPath), true);
  manager.endTask(paths.dir);
  assert.equal(memoryFiles.exists(paths.dir), false);
});

test("离线任务清掉安全残留、保护陌生文件并在结束后移除本次目录", () => {
  var memoryFiles = createMemoryFiles();
  var warnings = [];
  memoryFiles.addFile("/sdcard/20260725/video.mp4");
  memoryFiles.addFile("/sdcard/20260725/cover.jpg");
  memoryFiles.addFile("/sdcard/20260726（3）/video.mp4");
  memoryFiles.addFile("/sdcard/20260726（3）/family.png");
  var manager = createPublishMaterialManager({
    files: memoryFiles,
    storage: createStorage(),
    now: fixedDate,
    http: {
      get(url) { return { statusCode: 200, body: { bytes() { return Buffer.from(url); } } }; }
    },
    media: { scanFile() {} },
    logger: { warn(message) { warnings.push(message); } }
  });

  var paths = manager.beginTask({}, {});
  manager.download(paths, {
    videoUrl: "https://example.test/video.mp4",
    coverUrl: "https://example.test/cover.jpg"
  });
  assert.equal(memoryFiles.exists("/sdcard/20260725"), false);
  assert.equal(memoryFiles.exists("/sdcard/20260726（3）"), true);
  assert.equal(memoryFiles.exists(paths.dir), true);
  assert.equal(warnings.some((message) => /跳过素材目录清理/.test(message)), true);
  manager.endTask(paths.dir);
  assert.equal(memoryFiles.exists(paths.dir), false);
});

test("下载空文件错误包含素材名和 HTTP 状态", () => {
  var manager = createPublishMaterialManager({
    files: createMemoryFiles(),
    storage: createStorage(),
    now: fixedDate,
    http: { get() { return { statusCode: 200, body: { bytes() { return Buffer.alloc(0); } } }; } },
    media: { scanFile() {} },
    logger: { warn() {} }
  });
  var paths = { dir: "/sdcard/20260728", videoPath: "/sdcard/20260728/video.mp4", coverPath: "/sdcard/20260728/cover.jpg" };

  assert.throws(
    () => manager.download(paths, {
      videoUrl: "https://example.test/video.mp4",
      coverUrl: "https://example.test/cover.jpg"
    }),
    /视频素材下载失败：HTTP 200，文件为空/
  );
});

test("发布任务锁互斥、过期可接管且旧持有者不能释放新锁", () => {
  var values = {};
  var storage = createStorage(values);
  var now = 1000;
  var first = createPublishTaskLock({ storage, now: () => now, ownerId: "first" });
  var second = createPublishTaskLock({ storage, now: () => now, ownerId: "second" });

  assert.equal(first.acquire(), true);
  assert.equal(second.acquire(), false);
  now += 15 * 60 * 1000 + 1;
  assert.equal(second.acquire(), true);
  first.release();
  assert.equal(first.acquire(), false);
  second.release();
  assert.equal(first.acquire(), true);
  first.release();
});
