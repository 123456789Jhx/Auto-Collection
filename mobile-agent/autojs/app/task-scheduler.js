function createTaskScheduler(context) {
  var config = context.config;
  var logger = context.logger;

  var stateFilePath = files.join(config.output.baseDir, "task-scheduler-state.json");
  var supportedTaskTypes = {
    video: true,
    live: true,
    live_comment: true,
    commerce_card_live_comment: true
  };

  var state = {
    version: 1,
    activeTaskType: "",
    activeTask: null,
    updatedAt: "",
    tasks: {
      video: createEmptyTaskState("video"),
      live: createEmptyTaskState("live"),
      live_comment: createEmptyTaskState("live_comment"),
      commerce_card_live_comment: createEmptyTaskState("commerce_card_live_comment")
    }
  };

  function createEmptyTaskState(taskType) {
    return {
      taskType: taskType,
      status: "idle",
      checkpoint: null,
      startedAt: "",
      updatedAt: "",
      lastCommandType: "",
      lastReason: ""
    };
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function mergePlainObject(target, source) {
    var result = {};
    var key;
    target = target || {};
    source = source || {};
    for (key in target) {
      if (Object.prototype.hasOwnProperty.call(target, key)) {
        result[key] = target[key];
      }
    }
    for (key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        result[key] = source[key];
      }
    }
    return result;
  }

  function normalizeTaskType(taskType) {
    var value = String(taskType || "").trim();
    if (value === "live_comment_control" || value === "liveComment" || value === "live-comment") {
      value = "live_comment";
    }
    if (value === "commerceCardLiveComment" || value === "commerce-card-live-comment" || value === "commerce_card_live") {
      value = "commerce_card_live_comment";
    }
    if (value === "video_control" || value === "video_feed") {
      value = "video";
    }
    if (value === "live_control" || value === "live_feed") {
      value = "live";
    }
    return supportedTaskTypes[value] ? value : "";
  }

  function ensureTask(taskType) {
    var normalized = normalizeTaskType(taskType);
    if (!normalized) {
      return null;
    }
    if (!state.tasks[normalized]) {
      state.tasks[normalized] = createEmptyTaskState(normalized);
    }
    return state.tasks[normalized];
  }

  function writeState() {
    state.updatedAt = new Date().toISOString();
    try {
      files.write(stateFilePath, JSON.stringify(state, null, 2));
    } catch (error) {
      logger.warn("任务调度状态写入失败", {
        filePath: stateFilePath,
        message: String(error)
      });
    }
  }

  function mergeState(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.version) {
      state.version = data.version;
    }
    if (data.activeTaskType) {
      state.activeTaskType = normalizeTaskType(data.activeTaskType);
    }
    if (data.activeTask && typeof data.activeTask === "object") {
      state.activeTask = data.activeTask;
    }
    if (data.tasks && typeof data.tasks === "object") {
      Object.keys(data.tasks).forEach(function (key) {
        var normalized = normalizeTaskType(key);
        if (!normalized) {
          return;
        }
        state.tasks[normalized] = mergePlainObject(createEmptyTaskState(normalized), data.tasks[key] || {});
      });
    }
  }

  function loadState() {
    if (!files.exists(stateFilePath)) {
      writeState();
      return state;
    }
    try {
      var text = files.read(stateFilePath);
      if (text) {
        mergeState(JSON.parse(text));
      }
    } catch (error) {
      logger.warn("任务调度状态读取失败，使用内存默认值", {
        filePath: stateFilePath,
        message: String(error)
      });
    }
    return state;
  }

  function resolveTaskType(taskType, fallbackTaskType) {
    var normalized = normalizeTaskType(taskType);
    if (normalized) {
      return normalized;
    }
    normalized = normalizeTaskType(state.activeTaskType);
    if (normalized) {
      return normalized;
    }
    normalized = normalizeTaskType(fallbackTaskType);
    if (normalized) {
      return normalized;
    }
    return "video";
  }

  function getActiveTaskType() {
    return normalizeTaskType(state.activeTaskType);
  }

  function getActiveTask() {
    return state.activeTask ? clone(state.activeTask) : null;
  }

  function getTaskState(taskType) {
    var task = ensureTask(taskType);
    return task ? clone(task) : null;
  }

  function getCheckpoint(taskType) {
    var task = ensureTask(taskType);
    return task && task.checkpoint ? clone(task.checkpoint) : null;
  }

  function requestTask(taskType, commandType, meta) {
    var normalized = resolveTaskType(taskType);
    var task = ensureTask(normalized);
    if (!task) {
      return null;
    }
    if (state.activeTaskType && state.activeTaskType !== normalized) {
      var previousTask = ensureTask(state.activeTaskType);
      if (previousTask) {
        previousTask.status = "paused";
        previousTask.lastCommandType = "SWITCH";
        previousTask.lastReason = "switched_to_" + normalized;
        previousTask.updatedAt = new Date().toISOString();
      }
    }
    state.activeTaskType = normalized;
    state.activeTask = {
      taskType: normalized,
      commandType: commandType || "",
      status: "running",
      requestedAt: new Date().toISOString(),
      meta: clone(meta || {})
    };
    task.status = "running";
    task.lastCommandType = commandType || "";
    task.lastReason = (meta && meta.reason) || "";
    if (!task.startedAt) {
      task.startedAt = new Date().toISOString();
    }
    task.updatedAt = new Date().toISOString();
    writeState();
    return getActiveTask();
  }

  function pauseTask(taskType, meta) {
    var normalized = resolveTaskType(taskType);
    var task = ensureTask(normalized);
    if (!task) {
      return null;
    }
    task.status = "paused";
    task.lastCommandType = "PAUSE";
    task.lastReason = (meta && meta.reason) || "";
    task.updatedAt = new Date().toISOString();
    if (meta && meta.checkpoint) {
      task.checkpoint = clone(meta.checkpoint);
    }
    if (state.activeTask && state.activeTask.taskType === normalized) {
      state.activeTask.status = "paused";
      state.activeTask.meta = mergePlainObject(state.activeTask.meta || {}, clone(meta || {}));
    }
    writeState();
    return clone(task);
  }

  function stopTask(taskType, meta) {
    var normalized = resolveTaskType(taskType);
    var task = ensureTask(normalized);
    if (!task) {
      return null;
    }
    task.status = "stopped";
    task.lastCommandType = "STOP";
    task.lastReason = (meta && meta.reason) || "";
    task.updatedAt = new Date().toISOString();
    if (meta && meta.checkpoint) {
      task.checkpoint = clone(meta.checkpoint);
    }
    if (state.activeTask && state.activeTask.taskType === normalized) {
      state.activeTask.status = "stopped";
      state.activeTask.meta = mergePlainObject(state.activeTask.meta || {}, clone(meta || {}));
      state.activeTask = null;
      state.activeTaskType = "";
    }
    writeState();
    return clone(task);
  }

  function finishTask(taskType, meta) {
    var normalized = resolveTaskType(taskType);
    var task = ensureTask(normalized);
    if (!task) {
      return null;
    }
    task.status = (meta && meta.status) || "completed";
    task.lastCommandType = (meta && meta.commandType) || "FINISH";
    task.lastReason = (meta && meta.reason) || "";
    task.updatedAt = new Date().toISOString();
    if (meta && meta.checkpoint) {
      task.checkpoint = clone(meta.checkpoint);
    }
    if (state.activeTask && state.activeTask.taskType === normalized) {
      state.activeTask.status = task.status;
      state.activeTask.meta = mergePlainObject(state.activeTask.meta || {}, clone(meta || {}));
      state.activeTask = null;
      state.activeTaskType = "";
    }
    writeState();
    return clone(task);
  }

  function recordCheckpoint(taskType, checkpoint) {
    var normalized = resolveTaskType(taskType);
    var task = ensureTask(normalized);
    if (!task) {
      return null;
    }
    task.checkpoint = clone(checkpoint || {});
    task.updatedAt = new Date().toISOString();
    if (state.activeTask && state.activeTask.taskType === normalized) {
      state.activeTask.checkpoint = clone(checkpoint || {});
    }
    writeState();
    return clone(task.checkpoint);
  }

  function restoreTask(taskType, target) {
    var checkpoint = getCheckpoint(taskType);
    if (!checkpoint || !target) {
      return false;
    }
    Object.keys(checkpoint).forEach(function (key) {
      if (key === "taskType" || key === "checkpointType" || key === "extra") {
        return;
      }
      target[key] = checkpoint[key];
    });
    return true;
  }

  function snapshot() {
    return clone(state);
  }

  loadState();

  return {
    resolveTaskType: resolveTaskType,
    getActiveTaskType: getActiveTaskType,
    getActiveTask: getActiveTask,
    getTaskState: getTaskState,
    getCheckpoint: getCheckpoint,
    requestTask: requestTask,
    pauseTask: pauseTask,
    stopTask: stopTask,
    finishTask: finishTask,
    recordCheckpoint: recordCheckpoint,
    restoreTask: restoreTask,
    snapshot: snapshot,
    loadState: loadState
  };
}

module.exports = {
  createTaskScheduler: createTaskScheduler
};
