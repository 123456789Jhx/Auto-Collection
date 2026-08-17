# 抖音发布成功后后台清理 Implementation Plan

> **For agentic workers:** 本计划在当前会话内执行；仓库禁止 `git add`、`git commit`、`git reset`、`git checkout`、`git clean`、`git stash`。

**Goal:** 确保慢设备仍在发布时绝不清理抖音后台，并在成功后准确滑出已识别的抖音任务卡片。

**Architecture:** 保留现有 `waitForPublishSuccess -> 30 秒 cooldown -> recents` 链路。发布 UI 使用小型状态机收紧成功判定；后台清理模块增加冷却后二次保护，并从匹配节点推导滑动区域。

**Tech Stack:** AutoX.js/CommonJS、Node.js `node:test`

---

### Task 1: 发布状态判定

**Files:**
- Modify: `mobile-agent/autojs/features/publish-video/douyin-publish-ui.js`
- Test: `mobile-agent/autojs/tests/douyin-publish-ui.test.js`

- [ ] 增加测试：持续出现“发布进度”时不得成功。
- [ ] 增加测试：曾出现发布进度，随后首页稳定且发布表单消失时允许备用成功。
- [ ] 增加测试：从未出现发布进度时，普通首页不得误判成功。
- [ ] 最小实现状态记忆和连续稳定采样。
- [ ] 运行 `node --test mobile-agent/autojs/tests/douyin-publish-ui.test.js`。

### Task 2: 冷却后二次保护与准确滑卡

**Files:**
- Modify: `mobile-agent/autojs/features/publish-video/douyin-post-publish-cleanup.js`
- Test: `mobile-agent/autojs/tests/douyin-post-publish-cleanup.test.js`

- [ ] 增加测试：30 秒后仍在发布时不打开最近任务。
- [ ] 增加测试：识别到的抖音节点必须传给滑卡动作。
- [ ] 实现发布中检查和 `PUBLISH_STILL_IN_PROGRESS` 跳过原因。
- [ ] 根据匹配节点的卡片边界执行左滑，无可靠边界时拒绝盲滑。
- [ ] 运行 `node --test mobile-agent/autojs/tests/douyin-post-publish-cleanup.test.js`。

### Task 3: 回归与记录

**Files:**
- Modify: `docs/项目开发/远程脚本模块/进度台账.md`
- Modify: `docs/项目开发/项目记录.md`

- [ ] 运行两个定向测试及关联发布流程测试。
- [ ] 对改动 AutoJS 文件运行 `node --check`。
- [ ] 确认每个改动 AutoJS 源文件不超过 400 行。
- [ ] 运行只读 `git diff --check` 并确认节点 09 暂存区未改变。
- [ ] 回填实现范围、验证结果和真机待验边界。
