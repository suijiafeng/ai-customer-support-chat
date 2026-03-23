import { useCallback, useEffect, useRef, useState } from 'react';

let emojiPickerPromise: Promise<unknown> | null = null;
function loadEmojiPicker() {
  emojiPickerPromise ||= import('emoji-picker-element');
  return emojiPickerPromise;
}

interface UseEmojiPickerParams {
  onInsert: (emoji: string) => void;
  onOpen?: () => void; // 打开表情面板前（如需要关闭其他弹层）
}

export function useEmojiPicker({ onInsert, onOpen }: UseEmojiPickerParams) {
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiLoading, setEmojiLoading] = useState(false);
  const emojiRef = useRef<HTMLElement | null>(null);

  const toggleEmoji = useCallback(async () => {
    if (showEmoji) {
      setShowEmoji(false);
      return;
    }
    onOpen?.();
    setEmojiLoading(true);
    try {
      await loadEmojiPicker();
      setShowEmoji(true);
    } finally {
      setEmojiLoading(false);
    }
  }, [showEmoji, onOpen]);

  // emoji-picker 是 web component，需手动绑事件
  useEffect(() => {
    if (!showEmoji) return;
    const el = emojiRef.current;
    if (!el) return;
    const handler = (e: any) => {
      onInsert(e.detail?.unicode || '');
      setShowEmoji(false);
    };
    el.addEventListener('emoji-click', handler);
    return () => el.removeEventListener('emoji-click', handler);
  }, [showEmoji, onInsert]);

  const close = useCallback(() => setShowEmoji(false), []);

  return { showEmoji, emojiLoading, emojiRef, toggleEmoji, close };
}
