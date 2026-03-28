import { useCallback, useState } from 'react';

interface UseEmojiPickerParams {
  onInsert: (emoji: string) => void;
  onOpen?: () => void;
}

export function useEmojiPicker({ onInsert, onOpen }: UseEmojiPickerParams) {
  const [showEmoji, setShowEmoji] = useState(false);

  const toggleEmoji = useCallback(() => {
    setShowEmoji((v) => {
      if (!v) onOpen?.();
      return !v;
    });
  }, [onOpen]);

  const handleSelect = useCallback((emoji: string) => {
    onInsert(emoji);
    setShowEmoji(false);
  }, [onInsert]);

  const close = useCallback(() => setShowEmoji(false), []);

  return { showEmoji, emojiLoading: false, emojiRef: { current: null }, toggleEmoji, handleSelect, close };
}
