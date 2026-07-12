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
    version: 2,
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
      lastReason: "",
      assignmentId: "",
      workflowVersion: 1,
      stateVersion: 0,
      snapshotHash: "",
      lastCommandSequence: 0,
      lastEventSeq: 0,
      lastCommandId: "",
      lastCommandAckStatus: "",
      lastCommandAckResult: null
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

  function isTerminalTaskStatus(status) {
    var normalized = String(status || "").trim().toLowerCase();
    return normalized === "idle" ||
      normalized === "completed" ||
      normalized === "succeeded" ||
      normalized === "failed" ||
      normalized === "stopped" ||
      normalized === "cancelled" ||
      normalized === "expired";
  }

  function resetAssignmentBinding(task) {
    task.checkpoint = null;
    task.startedAt = "";
    task.assignmentId = "";
    task.workflowVersion = 1;
    task.stateVersion = 0;
    task.snapshotHash = "";
    task.lastCommandSequence = 0;
    task.lastEventSeq = 0;
    task.lastCommandId = "";
    task.lastCommandAckStatus = "";
    task.lastCommandAckResult = null;
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
      return true;
    } catch (error) {
      logger.warn("任务调度状态写入失败", {
        filePath: stateFilePath,
        message: String(error)
      });
      return false;
    }
  }

  function mergeState(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    if (data.version) {
      state.version = Math.max(2, Number(data.version) || 1);
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
    var previousTaskStatus = task.status;
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
    var effectiveWorkflow = meta && meta.effectiveWorkflow;
    if (effectiveWorkflow && Number(effectiveWorkflow.workflowVersion) === 2) {
      var workflowAssignmentId = String(effectiveWorkflow.assignmentId || "");
      if (task.assignmentId && task.assignmentId !== workflowAssignmentId && isTerminalTaskStatus(previousTaskStatus)) {
        resetAssignmentBinding(task);
      }
      if (!task.assignmentId || task.assignmentId === workflowAssignmentId) {
        task.assignmentId = workflowAssignmentId;
        task.workflowVersion = 2;
        task.stateVersion = Math.max(Number(task.stateVersion || 0), Number(effectiveWorkflow.stateVersion || 0));
        task.snapshotHash = String(effectiveWorkflow.snapshotHash || task.snapshotHash || "");
        task.lastEventSeq = Math.max(Number(task.lastEventSeq || 0), Number(effectiveWorkflow.lastEventSeq || 0));
        task.lastCommandSequence = Math.max(
          Number(task.lastCommandSequence || 0),
          Number(meta && meta.commandSequence || 0)
        );
        state.activeTask.assignmentId = task.assignmentId;
        state.activeTask.workflowVersion = task.workflowVersion;
        state.activeTask.stateVersion = task.stateVersion;
        state.activeTask.snapshotHash = task.snapshotHash;
        state.activeTask.lastEventSeq = task.lastEventSeq;
        state.activeTask.lastCommandSequence = task.lastCommandSequence;
      } else {
        logger.warn("忽略与当前运行任务不一致的工作流快照", {
          taskType: normalized,
          currentAssignmentId: task.assignmentId,
          workflowAssignmentId: workflowAssignmentId
        });
      }
    }
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
    if (!writeState()) {
      return null;
    }
    return clone(task.checkpoint);
  }

  function getAssignmentContext(taskType) {
    var task = ensureTask(taskType || state.activeTaskType);
    if (!task || !task.assignmentId) {
      return null;
    }
    return {
      assignmentId: task.assignmentId,
      workflowVersion: task.workflowVersion || 1,
      stateVersion: Number(task.stateVersion || 0),
      snapshotHash: task.snapshotHash || "",
      lastEventSeq: Number(task.lastEventSeq || 0),
      checkpoint: task.checkpoint ? clone(task.checkpoint) : null
    };
  }

  function updateAssignmentState(taskType, assignmentState, stateVersion) {
    var normalized = resolveTaskType(taskType);
    var task = ensureTask(normalized);
    if (!task) {
      return null;
    }
    task.status = String(assignmentState || task.status);
    task.stateVersion = Math.max(Number(task.stateVersion || 0), Number(stateVersion || 0));
    task.updatedAt = new Date().toISOString();
    if (state.activeTask && state.activeTask.taskType === normalized) {
      state.activeTask.status = task.status;
      state.activeTask.stateVersion = task.stateVersion;
    }
    writeState();
    return clone(task);
  }

  function updateAssignmentRuntime(taskType, assignmentState, stateVersion, lastEventSeq) {
    var task = updateAssignmentState(taskType, assignmentState, stateVersion);
    var stored = ensureTask(taskType);
    if (!stored) {
      return task;
    }
    stored.lastEventSeq = Math.max(Number(stored.lastEventSeq || 0), Number(lastEventSeq || 0));
    if (state.activeTask && state.activeTask.taskType === stored.taskType) {
      state.activeTask.lastEventSeq = stored.lastEventSeq;
    }
    writeState();
    return clone(stored);
  }

  function recordAssignmentCommand(taskType, assignmentId, commandSequence, stateVersion, commandId) {
    var task = ensureTask(taskType);
    if (!task) {
      return { accepted: false, reason: "unsupported_task_type" };
    }
    var normalizedAssignmentId = String(assignmentId || "");
    var sequence = Number(commandSequence || 0);
    if (!normalizedAssignmentId || sequence <= 0) {
      return { accepted: false, reason: "assignment_command_identity_missing" };
    }
    if (task.assignmentId && task.assignmentId !== normalizedAssignmentId) {
      if (!isTerminalTaskStatus(task.status)) {
        return { accepted: false, reason: "assignment_id_mismatch" };
      }
      resetAssignmentBinding(task);
    }
    var previousSequence = Number(task.lastCommandSequence || 0);
    var normalizedCommandId = String(commandId || "");
    if (sequence < previousSequence) {
      return { accepted: false, reason: "assignment_command_out_of_order" };
    }
    if (sequence === previousSequence && previousSequence > 0) {
      if (task.lastCommandId && normalizedCommandId && task.lastCommandId !== normalizedCommandId) {
        return { accepted: false, reason: "assignment_command_identity_conflict" };
      }
      return {
        accepted: true,
        duplicate: true,
        ackStatus: task.lastCommandAckStatus || "",
        ackResult: clone(task.lastCommandAckResult)
      };
    }
    task.assignmentId = normalizedAssignmentId;
    task.workflowVersion = 2;
    task.lastCommandSequence = sequence;
    task.stateVersion = Math.max(Number(task.stateVersion || 0), Number(stateVersion || 0));
    task.lastCommandId = normalizedCommandId;
    task.lastCommandAckStatus = "";
    task.lastCommandAckResult = null;
    task.updatedAt = new Date().toISOString();
    if (state.activeTask && state.activeTask.taskType === task.taskType) {
      state.activeTask.assignmentId = task.assignmentId;
      state.activeTask.workflowVersion = 2;
      state.activeTask.lastCommandSequence = task.lastCommandSequence;
      state.activeTask.stateVersion = task.stateVersion;
    }
    writeState();
    return { accepted: true, task: clone(task) };
  }

  function rememberAssignmentCommandAck(taskType, assignmentId, commandSequence, commandId, status, result) {
    var task = ensureTask(taskType);
    if (!task ||
      task.assignmentId !== String(assignmentId || "") ||
      Number(task.lastCommandSequence || 0) !== Number(commandSequence || 0) ||
      (task.lastCommandId && commandId && task.lastCommandId !== String(commandId))) {
      return false;
    }
    task.lastCommandId = String(commandId || task.lastCommandId || "");
    task.lastCommandAckStatus = String(status || "");
    task.lastCommandAckResult = clone(result || {});
    task.updatedAt = new Date().toISOString();
    if (state.activeTask && state.activeTask.taskType === task.taskType) {
      state.activeTask.lastCommandId = task.lastCommandId;
      state.activeTask.lastCommandAckStatus = task.lastCommandAckStatus;
      state.activeTask.lastCommandAckResult = clone(task.lastCommandAckResult);
    }
    return writeState();
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
    getAssignmentContext: getAssignmentContext,
    updateAssignmentState: updateAssignmentState,
    updateAssignmentRuntime: updateAssignmentRuntime,
    recordAssignmentCommand: recordAssignmentCommand,
    rememberAssignmentCommandAck: rememberAssignmentCommandAck,
    restoreTask: restoreTask,
    snapshot: snapshot,
    loadState: loadState
  };
}

module.exports = {
  createTaskScheduler: createTaskScheduler
};
