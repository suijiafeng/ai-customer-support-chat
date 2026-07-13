import { useEffect, useRef } from 'react';

/**
 * 安卓返回键支持：open 时向 history 推一条记录，
 * 用户按返回键（popstate）时调用 onClose。
 * 通过 UI 按钮关闭时应调用返回的 goBack()，保持 history 干净。
 */
export function useHistoryBack(open: boolean, onClose: () => void) {
  const pushed = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    history.pushState({ overlay: true }, '');
    pushed.current = true;

    const handler = () => {
      pushed.current = false;
      onCloseRef.current();
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, [open]);

  return function goBack() {
    if (pushed.current) {
      pushed.current = false;
      history.back(); // 触发 popstate → onClose
    } else {
      onCloseRef.current();
    }
  };
}
