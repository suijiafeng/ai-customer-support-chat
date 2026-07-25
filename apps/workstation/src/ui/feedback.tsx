import React, { useEffect, useState } from 'react';

// 轻量应用内反馈：toast 提示 + confirm 对话框，替代原生 window.alert/confirm。
// 用模块级订阅，组件外（如 catch 块）也能直接调用 showToast / confirmDialog。

type ToastKind = 'info' | 'success' | 'warning' | 'error';
interface ToastItem { id: number; text: string; kind: ToastKind; }
interface ConfirmReq {
  id: number;
  message: string;
  confirmText: string;
  cancelText: string;
  resolve: (ok: boolean) => void;
}

let toastSeq = 0;
let confirmSeq = 0;
const toastSubs = new Set<(items: ToastItem[]) => void>();
const confirmSubs = new Set<(req: ConfirmReq | null) => void>();
let toasts: ToastItem[] = [];
let activeConfirm: ConfirmReq | null = null;

function emitToasts() { toastSubs.forEach((fn) => fn(toasts)); }
function emitConfirm() { confirmSubs.forEach((fn) => fn(activeConfirm)); }

export function showToast(text: string, kind: ToastKind = 'info', durationMs = 3000) {
  const item: ToastItem = { id: ++toastSeq, text, kind };
  toasts = [...toasts, item];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emitToasts();
  }, durationMs);
}

export function confirmDialog(
  message: string,
  opts: { confirmText?: string; cancelText?: string } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    // 同一时刻只保留一个对话框：若已有，先取消旧的
    if (activeConfirm) activeConfirm.resolve(false);
    activeConfirm = {
      id: ++confirmSeq,
      message,
      confirmText: opts.confirmText || '确定',
      cancelText: opts.cancelText || '取消',
      resolve,
    };
    emitConfirm();
  });
}

/** 挂在 App 根部一次，渲染 toast 与 confirm 弹层。 */
export function FeedbackHost() {
  const [items, setItems] = useState<ToastItem[]>(toasts);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(activeConfirm);

  useEffect(() => {
    toastSubs.add(setItems);
    confirmSubs.add(setConfirm);
    return () => { toastSubs.delete(setItems); confirmSubs.delete(setConfirm); };
  }, []);

  const close = (ok: boolean) => {
    if (!confirm) return;
    confirm.resolve(ok);
    activeConfirm = null;
    emitConfirm();
  };

  return (
    <>
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
      {confirm && (
        <div className="dialog-overlay" onClick={() => close(false)}>
          <div className="dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className="dialog-msg">{confirm.message}</p>
            <div className="dialog-actions">
              <button className="dialog-cancel" onClick={() => close(false)}>{confirm.cancelText}</button>
              <button className="dialog-confirm" onClick={() => close(true)}>{confirm.confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
