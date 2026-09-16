import type { ActionKey, CommentActionTiming, TimingPair, TimingResponse } from "./api-client-comment-action-timing";
import { defaultCommentActionTiming } from "@pkg/types";

export type CommentTimingDraft = Omit<CommentActionTiming, "actions"> & { actions: Record<ActionKey, TimingPair> };

export const COMMENT_ACTIONS: Array<{ key: ActionKey; label: string; hint: string; group: string }> = [
  { key: "openDouyin", label: "打开抖音", hint: "应用进入前台后的等待", group: "打开与搜索" },
  { key: "openSearchEntry", label: "打开搜索入口", hint: "进入搜索输入页面", group: "打开与搜索" },
  { key: "setSearchKeyword", label: "输入关键词", hint: "完成关键词输入", group: "打开与搜索" },
  { key: "submitSearch", label: "提交搜索", hint: "等待搜索结果", group: "打开与搜索" },
  { key: "openLiveTab", label: "选择直播分类", hint: "等待直播列表加载", group: "打开与搜索" },
  { key: "openFirstLive", label: "进入第一个直播间", hint: "等待直播间稳定", group: "筛选直播间" },
  { key: "readViewerCount", label: "识别直播间人数", hint: "读取人数区域", group: "筛选直播间" },
  { key: "detectCommerceCart", label: "识别小黄车", hint: "检查商品入口", group: "筛选直播间" },
  { key: "openAnchorSummary", label: "打开主播信息", hint: "点击主播头像", group: "读取主播信息" },
  { key: "openAnchorProfile", label: "打开主播主页", hint: "进入主播主页", group: "读取主播信息" },
  { key: "readRoomIdentity", label: "读取主播身份", hint: "识别账号与昵称", group: "读取主播信息" },
  { key: "closeAnchorProfile", label: "返回直播间", hint: "关闭主播主页", group: "读取主播信息" },
  { key: "readComments", label: "读取当前页评论", hint: "识别评论文字", group: "评论与切房" },
  { key: "swipeComments", label: "评论区翻页", hint: "滑动并检测评论列表", group: "评论与切房" },
  { key: "finishRoomCapture", label: "完成当前直播间抓取", hint: "抓取结束后准备切房", group: "评论与切房" },
  { key: "nextLive", label: "切换下一个直播间", hint: "切房后等待重新筛选", group: "评论与切房" },
  { key: "commentOcrRetry", label: "评论识别失败重试", hint: "仅识别失败时执行", group: "评论与切房" }
];

export function cloneTimingPair(value: TimingPair): TimingPair {
  return { beforeMs: [...value.beforeMs], afterMs: [...value.afterMs] };
}

export function hasCompleteTiming(timing: CommentActionTiming | null): boolean {
  return Boolean(timing && COMMENT_ACTIONS.every(({ key }) => timing.actions[key]?.beforeMs && timing.actions[key]?.afterMs));
}

export function timingDraft(response?: Pick<TimingResponse, "timing" | "openDouyinWaitMs">): CommentTimingDraft {
  const actions = {} as CommentTimingDraft["actions"];
  for (const { key } of COMMENT_ACTIONS) {
    const defaults = defaultCommentActionTiming.actions[key];
    const custom = response?.timing?.actions[key];
    const fallback = {
      beforeMs: [...defaults.beforeMs] as [number, number],
      afterMs: key === "openDouyin" && response?.openDouyinWaitMs ? response.openDouyinWaitMs : [...defaults.afterMs] as [number, number]
    };
    actions[key] = cloneTimingPair({ beforeMs: custom?.beforeMs || fallback.beforeMs, afterMs: custom?.afterMs || fallback.afterMs });
  }
  return { schemaVersion: 1, enabled: response?.timing?.enabled ?? true, actions };
}

export function validateTiming(timing: CommentTimingDraft): string | null {
  for (const { key, label } of COMMENT_ACTIONS) {
    const value = timing.actions[key];
    if (!value) continue;
    for (const side of ["beforeMs", "afterMs"] as const) {
      const range = value[side];
      if (range.some((item) => !Number.isInteger(item) || item < 0 || item > 120000)) return `${label}：请输入 0～120000 之间的整数毫秒。`;
      if (range[0] > range[1]) return `${label}：最短等待不能大于最长等待。`;
    }
  }
  return null;
}

export function formatRange(range: [number, number]) {
  return range[0] === range[1] ? `${range[0]} ms` : `${range[0]}～${range[1]} ms`;
}

export function timingDifferences(source: CommentActionTiming, target: CommentActionTiming) {
  const changes: Array<{ label: string; before: string; after: string }> = [];
  if (source.enabled !== target.enabled) changes.push({ label: "自定义间隔", before: target.enabled ? "启用" : "停用", after: source.enabled ? "启用" : "停用" });
  for (const { key, label } of COMMENT_ACTIONS) {
    for (const side of ["beforeMs", "afterMs"] as const) {
      const next = source.actions[key]?.[side] || [0, 0] as [number, number];
      const prior = target.actions[key]?.[side] || [0, 0] as [number, number];
      if (next[0] !== prior[0] || next[1] !== prior[1]) changes.push({ label: `${label} · ${side === "beforeMs" ? "动作前" : "动作后"}`, before: formatRange(prior), after: formatRange(next) });
    }
  }
  return changes;
}

export function adjacentWait(timing: CommentActionTiming, first: ActionKey, second: ActionKey): [number, number] {
  const after = timing.actions[first]?.afterMs || [0, 0];
  const before = timing.actions[second]?.beforeMs || [0, 0];
  return [after[0] + before[0], after[1] + before[1]];
}
