const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createActionTimeGate } = require("../domain/动作时间闸口.js");
const { validateDescriptionTopics, validateTopics } = require("../domain/话题校验.js");
const { createTopicContinuation } = require("../domain/话题断点续传.js");
const { chooseVideoMaterial } = require("../domain/素材判断.js");

test("动作闸口每次在两个配置区间内独立生成延时", () => {
  const randomValues = [0, 0.25, 0.5, 0.75];
  const sleeps = [];
  let targetChecks = 0;
  const gate = createActionTimeGate({
    responseDelayMsMin: 100,
    responseDelayMsMax: 200,
    actionWaitMsMin: 300,
    actionWaitMsMax: 400,
    targetStateTimeoutMs: 2000,
    pollIntervalMs: 20
  }, {
    random() {
      return randomValues.shift();
    },
    sleep(value) {
      sleeps.push(value);
    },
    now() {
      return sleeps.length * 20;
    }
  });

  const first = gate.waitForNext("选择发布素材", () => {
    targetChecks += 1;
    return targetChecks >= 3;
  });
  const second = gate.waitForNext("编辑封面", () => true);

  assert.equal(targetChecks, 3);
  assert.ok(first.responseDelayMs >= 100 && first.responseDelayMs <= 200);
  assert.ok(first.actionWaitMs >= 300 && first.actionWaitMs <= 400);
  assert.ok(second.responseDelayMs >= 100 && second.responseDelayMs <= 200);
  assert.ok(second.actionWaitMs >= 300 && second.actionWaitMs <= 400);
  assert.notEqual(first.responseDelayMs, second.responseDelayMs);
  assert.notEqual(first.actionWaitMs, second.actionWaitMs);
  assert.deepEqual(sleeps.slice(-4), [100, 325, 150, 375]);
});

test("动作闸口轮询超出安全上限时给出目标动作原因", () => {
  let now = 0;
  const gate = createActionTimeGate({
    responseDelayMsMin: 1,
    responseDelayMsMax: 1,
    actionWaitMsMin: 1,
    actionWaitMsMax: 1,
    targetStateTimeoutMs: 30,
    pollIntervalMs: 10
  }, {
    random() { return 0; },
    sleep(value) { now += value; },
    now() { return now; }
  });

  assert.throws(
    () => gate.waitForNext("填写标题描述话题", () => false),
    /等待填写标题描述话题目标状态超时/
  );
});

test("话题校验要求描述话题与界面已选话题同时达到预期", () => {
  const valid = validateTopics("春耕记录 #春耕 #农技", ["#春耕", "农技"], 2);
  const pending = validateTopics("春耕记录 #春耕 #农技", ["春耕"], 2);

  assert.equal(valid.valid, true);
  assert.deepEqual(valid.requiredTopics, ["春耕", "农技"]);
  assert.equal(pending.valid, false);
  assert.equal(pending.status, "TOPIC_PENDING");
  assert.match(pending.reason, /农技/);
});

test("手机描述话题校验与 API 规则一致", () => {
  assert.deepEqual(validateDescriptionTopics("春耕 #一 #二 #三 #四", 5), {
    valid: false,
    actualCount: 4,
    reason: "应有5个#，实际4个"
  });
  assert.deepEqual(validateDescriptionTopics("春耕 #一 #二 # #四 #五", 5), {
    valid: false,
    actualCount: 5,
    reason: "第3个#后无文字"
  });
});

test("话题断点轮询先 pending 后 resolved 并释放亮屏", () => {
  const events = [];
  const responses = [
    { resolved: false, status: "TOPIC_PENDING", description: "只有 #一个" },
    { resolved: true, status: "DISPATCHED", description: "补全 #一 #二" }
  ];
  let now = 0;
  const continuation = createTopicContinuation({
    fetchTopic() { events.push("poll"); return responses.shift(); },
    sleep(ms) { events.push("sleep:" + ms); now += ms; },
    now() { return now; },
    keepAwake(ms) { events.push("awake:" + ms); },
    releaseAwake() { events.push("release-awake"); }
  });

  const result = continuation.waitForResolvedDescription({
    taskId: "topic-resume",
    description: "只有 #一个",
    expectedTopicCount: 2,
    topicResolveTimeoutMinutes: 1
  });

  assert.equal(result, "补全 #一 #二");
  assert.deepEqual(events, ["awake:60000", "poll", "sleep:20000", "poll", "release-awake"]);
});

test("话题断点超时给出固定文案并释放亮屏", () => {
  const events = [];
  let now = 0;
  const continuation = createTopicContinuation({
    fetchTopic() { events.push("poll"); return { resolved: false, status: "TOPIC_PENDING" }; },
    sleep(ms) { now += ms; },
    now() { return now; },
    keepAwake() { events.push("awake"); },
    releaseAwake() { events.push("release-awake"); }
  });

  assert.throws(() => continuation.waitForResolvedDescription({
    taskId: "topic-timeout",
    expectedTopicCount: 2,
    topicResolveTimeoutMinutes: 0.5
  }), /话题补全超时/);
  assert.deepEqual(events.at(-1), "release-awake");
});

test("素材判断先看第一项，第一项为图时选择第二个视频", () => {
  assert.deepEqual(chooseVideoMaterial([
    { durationText: "" },
    { durationText: "00:18" }
  ]), {
    valid: true,
    index: 1,
    durationText: "00:18"
  });
});

test("前两项都不是视频时返回素材未正确上传", () => {
  assert.deepEqual(chooseVideoMaterial([
    { durationText: "" },
    { durationText: "图片" }
  ]), {
    valid: false,
    index: -1,
    reason: "素材未正确上传"
  });
});
