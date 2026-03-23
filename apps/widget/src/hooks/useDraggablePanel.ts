import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 悬浮球/窗口的移动端检测 + 拖拽定位。
 * 纯 UI/布局关注点，不涉及会话或消息数据。
 */
export function useDraggablePanel() {
  const [mobile, setMobile] = useState(false);
  // 窗口左上角；null = 居中（由 CSS 控制）
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const panelEl = useRef<HTMLDivElement | null>(null);
  const pdown = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const computeMobile = () =>
      setMobile(window.matchMedia('(max-width: 480px), (max-height: 560px)').matches);
    computeMobile();

    const onResize = () => {
      computeMobile();
      setPanelPos((pos) => {
        if (!pos || !panelEl.current) return pos;
        const w = panelEl.current.offsetWidth;
        const h = panelEl.current.offsetHeight;
        return {
          x: Math.max(8, Math.min(pos.x, window.innerWidth - w - 8)),
          y: Math.max(8, Math.min(pos.y, window.innerHeight - h - 8)),
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

  return {
    mobile,
    panelPos,
    setPanelPos,
    dragging,
    panelRef: panelEl,
    onHeadDown,
    onHeadMove,
    onHeadUp,
  };
}
