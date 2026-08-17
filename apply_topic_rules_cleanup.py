from pathlib import Path
import re

ROOT = Path(__file__).parent
ENTRY = ROOT / "mobile-agent/autojs/features/publish-video/publish-video-entry.js"
CHANNELS = ROOT / "mobile-agent/autojs/features/publish-video/channels-publish-flow.js"


def read_source(path):
    raw = path.read_text(encoding="utf-8")
    line_ending = "\r\n" if "\r\n" in raw else "\n"
    return raw.replace("\r\n", "\n"), line_ending


def write_source(path, text, line_ending):
    with path.open("w", encoding="utf-8", newline="") as output:
        output.write(text.replace("\n", line_ending))


def replace_once(text, label, pattern, replacement):
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}：预期替换 1 处，实际替换 {count} 处；已停止，未写入文件。")
    return updated


def remove_once(text, label, value):
    count = text.count(value)
    if count != 1:
        raise RuntimeError(f"{label}：预期找到 1 处，实际找到 {count} 处；已停止，未写入文件。")
    return text.replace(value, "", 1)


entry, entry_ending = read_source(ENTRY)
channels, channels_ending = read_source(CHANNELS)

entry = replace_once(
    entry,
    "删除话题补全查询",
    r'\nfunction createTopicQuery\(config\) \{.*?\n\}\n\nfunction createResultReporter',
    '\nfunction createResultReporter',
)
entry = remove_once(
    entry,
    "删除抖音填写步骤的话题校验依赖",
    '  var topicDomain = loadBizModule(context, "domain/topic-validator.js");\n',
)
entry = remove_once(
    entry,
    "改为只填写标题和作品描述",
    '.createFillPublishTextStep(ui, topicDomain)',
).replace('.createFillPublishTextStep(ui)', '.createFillPublishTextStep(ui)', 1)

entry = replace_once(
    entry,
    "删除抖音话题断点续传初始化",
    r'  var topicDomain = dependencies\.topicDomain \|\| loadBizModule\(context, "domain/topic-validator\.js"\);\n'
    r'  var topicContinuation = dependencies\.topicContinuation \|\| loadBizModule\(context, "domain/topic-resume\.js"\)\n'
    r'    \.createTopicContinuation\(\{\n'
    r'      fetchTopic: createTopicQuery\(context\.config\),\n'
    r'      validateDescriptionTopics: topicDomain\.validateDescriptionTopics\n'
    r'    \}\);\n',
    '',
)
entry = remove_once(
    entry,
    "删除视频号话题续传依赖传递",
    '          resultReporter: resultReporter,\n          topicContinuation: topicContinuation\n',
).replace('          resultReporter: resultReporter\n', '          resultReporter: resultReporter\n', 1)

entry = remove_once(
    entry,
    "删除TOPIC_PENDING命令确认状态",
    '    var ackStatus = status === "SUCCEEDED" || status === "TOPIC_PENDING" ? "DONE" : "FAILED";\n',
).replace(
    '    var ackStatus = status === "SUCCEEDED" ? "DONE" : "FAILED";\n',
    '    var ackStatus = status === "SUCCEEDED" ? "DONE" : "FAILED";\n',
    1,
)

entry = replace_once(
    entry,
    "删除抖音话题待补和轮询逻辑",
    r'  function reportTopicPending\(payload, reason\) \{.*?\n  \}\n\n'
    r'  function fillWithTopicContinuation\(activeSteps, payload, materials\) \{.*?\n  \}\n\n'
    r'  function handle',
    '  function fillDescription(activeSteps, payload, materials) {\n'
    '    return activeSteps.fill(payload, materials);\n'
    '  }\n\n'
    '  function handle',
)
entry = replace_once(
    entry,
    "删除抖音话题数量预检查",
    r'      var topicValidation = topicDomain\.validateDescriptionTopics\(\n'
    r'        payload\.description,\n'
    r'        payload\.expectedTopicCount\n'
    r'      \);\n'
    r'      if \(!topicValidation\.valid\) \{\n'
    r'        return finish\(command, payload, "TOPIC_PENDING", topicValidation\.reason, null, executionGuard\);\n'
    r'      \}\n',
    '',
)

entry_count = entry.count("fillWithTopicContinuation")
if entry_count != 2:
    raise RuntimeError(f"替换抖音填写调用：预期 2 处，实际 {entry_count} 处；已停止，未写入文件。")
entry = entry.replace("fillWithTopicContinuation", "fillDescription")

channels = replace_once(
    channels,
    "删除视频号TOPIC_PENDING错误定义",
    r'\nfunction topicPending\(message\) \{.*?\n\}\n\nfunction createWechatChannelsPublishHandler',
    '\nfunction createWechatChannelsPublishHandler',
)
channels = remove_once(
    channels,
    "删除视频号话题校验依赖",
    '  var topicDomain = loadBizModule(context, "domain/topic-validator.js");\n',
)
channels = remove_once(
    channels,
    "删除视频号话题续传依赖",
    '  var topicContinuation = dependencies.topicContinuation;\n',
)
channels = replace_once(
    channels,
    "删除视频号话题选择和校验",
    r'  function fillAndValidateTopics\(payload\) \{.*?\n  \}\n\n'
    r'  function reportTopicPending\(payload, reason\) \{.*?\n  \}\n\n'
    r'  function finish',
    '  function fillDescription(payload) {\n'
    '    performAction("填写描述", function () { ui.fillDescription(payload.description); });\n'
    '  }\n\n'
    '  function finish',
)
channels = replace_once(
    channels,
    "删除视频号TOPIC_PENDING确认状态",
    r'    var ackStatus = status === "SUCCEEDED" \|\| status === "TOPIC_PENDING" \|\|\n'
    r'      status === "CHANNELS_VERIFY_PENDING" \? "DONE" : "FAILED";',
    '    var ackStatus = status === "SUCCEEDED" || status === "CHANNELS_VERIFY_PENDING" ? "DONE" : "FAILED";',
)
channels = replace_once(
    channels,
    "删除视频号话题数量校验与补全等待",
    r'      var topicResult = fillAndValidateTopics\(payload\);\n'
    r'      if \(!topicResult\.valid\) \{.*?\n'
    r'      \}\n'
    r'      waitForNext\(gate, "发表视频", ui\.states\.publishReady\);',
    '      fillDescription(payload);\n'
    '      waitForNext(gate, "发表视频", ui.states.publishReady);',
)

if "TOPIC_PENDING" in entry or "TOPIC_PENDING" in channels:
    raise RuntimeError("仍发现 TOPIC_PENDING，已停止，未写入文件。")

write_source(ENTRY, entry, entry_ending)
write_source(CHANNELS, channels, channels_ending)

print("已更新：")
print(ENTRY)
print(CHANNELS)
print("话题现在只保留在作品描述文本中，不再单独选择、计数、补全或等待。")