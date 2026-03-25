import { useCallback, useEffect, useRef, useState } from 'react';

const EDGE = 20; // 吸附后与屏幕左/右边缘的间距
const GAP = 8; // 拖动中与视口边缘保留的最小间距
const DRAG_THRESHOLD = 6; // 位移小于该值视为点击而非拖拽

/**
 * 悬浮球（入口按钮）拖拽：可自由拖动，松手后保持纵向位置，
 * 按视口 50% 中线自动吸附到左或右边缘。
 */
export function useDraggableFab() {
  // null = 默认位置（CSS 右下角）；拖动后改用 fixed + left/top 定位
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fabRef = useRef<HTMLButtonElement | null>(null);
  const sideRef = useRef<'left' | 'right'>('right'); // 记住吸附侧，窗口 resize 时沿用
  const draggedRef = useRef(false); // 本次按下是否发生了拖拽（用于抑制随后的 click）
  const down = useRef<{ px: number; py: number; x: number; y: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const onResize = () => {
      setPos((p) => {
        if (!p || !fabRef.current) return p;
        const w = fabRef.current.offsetWidth;
        const h = fabRef.current.offsetHeight;
        return {
          x: sideRef.current === 'left' ? EDGE : window.innerWidth - w - EDGE,
          y: Math.max(GAP, Math.min(p.y, window.innerHeight - h - GAP)),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onFabDown = useCallback((e: React.PointerEvent) => {
    if (!fabRef.current) return;
    const rect = fabRef.current.getBoundingClientRect();
    down.current = { px: e.clientX, py: e.clientY, x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onFabMove = useCallback((e: React.PointerEvent) => {
    const d = down.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    draggedRef.current = true;
    setDragging(true);
    setPos({
      x: Math.max(GAP, Math.min(d.x + dx, window.innerWidth - d.w - GAP)),
      y: Math.max(GAP, Math.min(d.y + dy, window.innerHeight - d.h - GAP)),
    });
  }, []);

  const onFabUp = useCallback((e: React.PointerEvent) => {
    const d = down.current;
    down.current = null;
    if (!d || !draggedRef.current) return;
    setDragging(false);
    // 松手：保持纵向位置，按 50% 中线决定吸附到左边还是右边
    const x = Math.max(GAP, Math.min(d.x + (e.clientX - d.px), window.innerWidth - d.w - GAP));
    const y = Math.max(GAP, Math.min(d.y + (e.clientY - d.py), window.innerHeight - d.h - GAP));
    const side = x + d.w / 2 < window.innerWidth / 2 ? 'left' : 'right';
    sideRef.current = side;
    setPos({ x: side === 'left' ? EDGE : window.innerWidth - d.w - EDGE, y });
  }, []);

  // click 事件在 pointerup 之后触发；拖拽结束产生的 click 不应切换窗口
  const consumeDrag = useCallback(() => {
    const moved = draggedRef.current;
    draggedRef.current = false;
    return moved;
  }, []);

  return { fabRef, fabPos: pos, fabDragging: dragging, onFabDown, onFabMove, onFabUp, consumeDrag };
}
