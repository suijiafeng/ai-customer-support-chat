import { useCallback, useEffect, useRef, useState } from 'react';

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// 窗口尺寸边界：拖拽调整时的下限/上限（上限同时受视口约束）
const MIN_W = 320;
const MIN_H = 420;
const MAX_W = 760;
const MAX_H = 1080;
const GAP = 8; // 与视口边缘保留的最小间距

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * 悬浮球/窗口的移动端检测 + 拖拽定位 + 边缘拖拽改变宽高。
 * 纯 UI/布局关注点，不涉及会话或消息数据。
 */
export function useDraggablePanel() {
  const [mobile, setMobile] = useState(false);
  // 窗口左上角；null = 居中（由 CSS 控制）
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  // 窗口宽高；null = 默认尺寸（由 CSS 控制）。关闭重开后保留用户调整的尺寸
  const [panelSize, setPanelSize] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const panelEl = useRef<HTMLDivElement | null>(null);
  const pdown = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const rdown = useRef<{
    px: number; py: number; x: number; y: number; w: number; h: number; dir: ResizeDir;
  } | null>(null);

  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const computeMobile = () => {
      setMobile(window.matchMedia('(max-width: 480px), (max-height: 560px)').matches);
      setNarrow(window.matchMedia('(max-width: 600px)').matches);
    };
    computeMobile();

    const onResize = () => {
      computeMobile();
      setPanelSize((size) =>
        size
          ? {
              w: Math.min(size.w, MAX_W, window.innerWidth - GAP * 2),
              h: Math.min(size.h, MAX_H, window.innerHeight - GAP * 2),
            }
          : size
      );
      setPanelPos((pos) => {
        if (!pos || !panelEl.current) return pos;
        const w = panelEl.current.offsetWidth;
        const h = panelEl.current.offsetHeight;
        return {
          x: Math.max(GAP, Math.min(pos.x, window.innerWidth - w - GAP)),
          y: Math.max(GAP, Math.min(pos.y, window.innerHeight - h - GAP)),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ---- 悬浮球：固定右下角、不可拖；窗口：居中弹出、可拖动 ----
  const onHeadDown = useCallback(
    (e: React.PointerEvent) => {
      if (mobile || !panelEl.current) return;
      if ((e.target as HTMLElement).closest?.('.x')) return; // 关闭按钮不触发拖拽
      const rect = panelEl.current.getBoundingClientRect();
      setPanelPos({ x: rect.left, y: rect.top }); // 切到绝对定位，无跳变
      pdown.current = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top };
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [mobile]
  );

  const onHeadMove = useCallback((e: React.PointerEvent) => {
    if (!pdown.current || !panelEl.current) return;
    const w = panelEl.current.offsetWidth;
    const h = panelEl.current.offsetHeight;
    const nx = pdown.current.x + (e.clientX - pdown.current.px);
    const ny = pdown.current.y + (e.clientY - pdown.current.py);
    setPanelPos({
      x: Math.max(8, Math.min(nx, window.innerWidth - w - 8)),
      y: Math.max(8, Math.min(ny, window.innerHeight - h - 8)),
    });
  }, []);

  const onHeadUp = useCallback(() => {
    if (!pdown.current) return;
    pdown.current = null;
    setDragging(false);
  }, []);

  // ---- 边缘/角落拖拽调整宽高 ----
  const onResizeDown = useCallback(
    (e: React.PointerEvent, dir: ResizeDir) => {
      if (mobile || !panelEl.current) return;
      e.preventDefault(); // 避免拖动时选中页面文本
      const rect = panelEl.current.getBoundingClientRect();
      // 切到绝对定位并固定当前尺寸：居中态下伸缩才会锚定对侧边，不会双边同时变化
      setPanelPos({ x: rect.left, y: rect.top });
      setPanelSize({ w: rect.width, h: rect.height });
      rdown.current = {
        px: e.clientX, py: e.clientY,
        x: rect.left, y: rect.top, w: rect.width, h: rect.height, dir,
      };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [mobile]
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const d = rdown.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    let { x, y, w, h } = d;
    if (d.dir.includes('e')) w = clamp(d.w + dx, MIN_W, Math.min(MAX_W, window.innerWidth - d.x - GAP));
    if (d.dir.includes('s')) h = clamp(d.h + dy, MIN_H, Math.min(MAX_H, window.innerHeight - d.y - GAP));
    if (d.dir.includes('w')) {
      w = clamp(d.w - dx, MIN_W, Math.min(MAX_W, d.x + d.w - GAP));
      x = d.x + d.w - w; // 左边伸缩时右边缘保持不动
    }
    if (d.dir.includes('n')) {
      h = clamp(d.h - dy, MIN_H, Math.min(MAX_H, d.y + d.h - GAP));
      y = d.y + d.h - h; // 上边伸缩时下边缘保持不动
    }
    setPanelSize({ w, h });
    setPanelPos({ x, y });
  }, []);

  const onResizeUp = useCallback(() => {
    rdown.current = null;
  }, []);

  return {
    mobile,
    narrow,
    panelPos,
    setPanelPos,
    panelSize,
    dragging,
    panelRef: panelEl,
    onHeadDown,
    onHeadMove,
    onHeadUp,
    onResizeDown,
    onResizeMove,
    onResizeUp,
  };
}
