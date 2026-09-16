import { CommentOutlined } from "@ant-design/icons";
import { useEffect, useRef, type ReactNode } from "react";
import "./live-comment-workspace.css";

/** Background-only motion: controls never move, and touch/reduced-motion stay still. */
export function LiveCommentWorkspace(props: { children: ReactNode; running: number; batchId: string }) {
  const surface = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce), (hover: none)");
    let frame = 0;
    let x = 0;
    let y = 0;
    const paint = () => {
      frame = 0;
      element.style.setProperty("--lc-pointer-x", `${x.toFixed(2)}px`);
      element.style.setProperty("--lc-pointer-y", `${y.toFixed(2)}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    const reset = () => { x = 0; y = 0; schedule(); };
    const move = (event: PointerEvent) => {
      if (preference.matches || event.pointerType !== "mouse") return;
      const bounds = element.getBoundingClientRect();
      x = Math.max(-8, Math.min(8, ((event.clientX - bounds.left) / bounds.width - 0.5) * 16));
      y = Math.max(-8, Math.min(8, ((event.clientY - bounds.top) / bounds.height - 0.5) * 16));
      schedule();
    };
    element.addEventListener("pointermove", move, { passive: true });
    element.addEventListener("pointerleave", reset);
    preference.addEventListener("change", reset);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerleave", reset);
      preference.removeEventListener("change", reset);
    };
  }, []);

  return (
    <div className="ops-page live-comment-entry-page lc-workspace" ref={surface}>
      <div className="lc-atmosphere" aria-hidden="true">
        <div className="lc-atmosphere-glow" /><div className="lc-atmosphere-grid" /><div className="lc-atmosphere-noise" />
      </div>
      <header className="lc-workspace-header">
        <div className="lc-workspace-title">
          <span className="lc-workspace-mark"><CommentOutlined /></span>
          <div><h1>抓取评论词</h1><p>从直播间发现真实表达，让每一条评论都有迹可循。</p></div>
        </div>
        <div className="lc-workspace-status" data-active={props.running > 0}>
          <span aria-hidden="true" />
          {props.running > 0 ? `${props.running} 台设备执行中` : props.batchId ? "本批记录已保留" : "准备开始"}
        </div>
      </header>
      <ol className="lc-workspace-flow" aria-label="抓取评论操作流程">
        <li><span>01</span><strong>设置抓取任务</strong><small>关键词与筛选条件</small></li>
        <li><span>02</span><strong>查看设备进度</strong><small>实时阶段与任务记录</small></li>
        <li><span>03</span><strong>整理评论结果</strong><small>筛选入库与用户画像</small></li>
      </ol>
      <div className="lc-workspace-columns">{props.children}</div>
    </div>
  );
}
