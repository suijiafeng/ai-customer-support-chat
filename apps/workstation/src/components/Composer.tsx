import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@assistflow/shared';
import {
  requestJson, fileToDataUrl, normalizeMessages, MAX_ATTACHMENTS, MAX_IMAGE_BYTES,
  type AgentIdentity, type PendingAttachment, type UiMessage,
} from '../api.js';

interface ComposerProps {
  sessionId: string | null;
  agent: AgentIdentity;
  onSent?: (messages: UiMessage[]) => void;
}

export default function Composer({ sessionId, agent, onSent }: ComposerProps) {
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState<PendingAttachment[]>([]); // 待发送图片附件
  const [loading, setLoading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showCanned, setShowCanned] = useState(false);

  const fileEl = useRef<HTMLInputElement | null>(null);
  const replyInput = useRef<HTMLTextAreaElement | null>(null);
  const emojiRef = useRef<HTMLElement | null>(null);

  // 切换会话时重置输入区
  useEffect(() => {
    setReply(''); setPending([]); setShowEmoji(false);
    requestAnimationFrame(() => replyInput.current?.focus());
  }, [sessionId]);

  const addFiles = useCallback(async (files: Iterable<File>) => {
    const list = [...files].filter((f) => f && f.type.startsWith('image/') && f.size <= MAX_IMAGE_BYTES);
    if (!list.length) return;
    const items = await Promise.all(list.map(fileToDataUrl));
    setPending((p) => [...p, ...items].slice(0, MAX_ATTACHMENTS));
  }, []);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const items = [...(e.clipboardData?.items || [])].filter((i) => i.type.startsWith('image/'));
    if (items.length) {
      e.preventDefault();
      addFiles(items.map((i) => i.getAsFile()).filter((f): f is File => Boolean(f)));
    }
  }, [addFiles]);

  const onPickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files || []);
    e.target.value = '';
  }, [addFiles]);
  const removePending = useCallback((i: number) => setPending((p) => p.filter((_, idx) => idx !== i)), []);

  // emoji-picker 是 web component，需手动绑事件
  useEffect(() => {
    if (!showEmoji) return;
    const el = emojiRef.current;
    if (!el) return;
    const handler = (e: any) => {
      setReply((r) => r + (e.detail?.unicode || ''));
      setShowEmoji(false);
      requestAnimationFrame(() => replyInput.current?.focus());
    };
    el.addEventListener('emoji-click', handler);
    return () => el.removeEventListener('emoji-click', handler);
  }, [showEmoji]);

  const send = useCallback(async () => {
    const content = reply.trim();
    const attachments = pending;
    if ((!content && attachments.length === 0) || !sessionId || loading) return;
    setLoading(true);
    try {
      const data = await requestJson<{ messages: Message[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, attachments }),
        }
      );
      onSent?.(normalizeMessages(data.messages));
      setReply(''); setPending([]); setShowEmoji(false);
    } catch {
      alert('消息发送失败，请重试');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => replyInput.current?.focus());
    }
  }, [reply, pending, sessionId, loading, onSent]);

  // 快捷回复：常用语一键插入输入框
  const CANNED_REPLIES = [
    '您好，我是客服，请问有什么可以帮您？',
    '收到，我先确认一下，请稍等。',
    '请留下您的联系方式和需求摘要，我们会尽快跟进。',
    '该问题已记录为跟进事项，会有专人与您联系。',
    '感谢咨询，如还有问题随时联系我们，祝您生活愉快！',
  ];
  const insertCanned = useCallback((text: string) => {
    setReply((r) => (r ? `${r}${r.endsWith('\n') ? '' : '\n'}${text}` : text));
    setShowCanned(false);
    requestAnimationFrame(() => replyInput.current?.focus());
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    send();
  }, [send]);

  const canSend = Boolean(reply.trim()) || pending.length > 0;

  return (
    <>
      {pending.length > 0 && (
        <div className="previews">
          {pending.map((p, i) => (
            <div key={p.id || i} className="thumb">
              <img src={p.dataUrl} alt={p.name || '待发送图片'} />
              <button onClick={() => removePending(i)} aria-label="移除图片">×</button>
            </div>
          ))}
        </div>
      )}

      {showEmoji && (
        <div className="emoji-pop">
          <emoji-picker ref={emojiRef}></emoji-picker>
        </div>
      )}

      {showCanned && (
        <div className="canned-pop" role="menu" aria-label="快捷回复">
          {CANNED_REPLIES.map((text) => (
            <button key={text} role="menuitem" onClick={() => insertCanned(text)}>{text}</button>
          ))}
        </div>
      )}

      <div className="composer-wrap">
        <div className="composer">
          <textarea
            ref={replyInput}
            value={reply}
            rows={2}
            placeholder="输入回复…"
            aria-label="开发者回复"
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          <div className="composer-foot">
            <div className="tools">
              <button
                type="button"
                className={`tool${showEmoji ? ' active' : ''}`}
                title="表情"
                aria-label="插入表情"
                aria-pressed={showEmoji}
                onClick={() => setShowEmoji((v) => !v)}
              >😊</button>
              <button
                type="button"
                className={`tool${showCanned ? ' active' : ''}`}
                title="快捷回复"
                aria-label="快捷回复"
                aria-pressed={showCanned}
                onClick={() => { setShowCanned((v) => !v); setShowEmoji(false); }}
              >⚡</button>
              <input ref={fileEl} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
              <span className="key-hint">Shift + Enter 换行</span>
            </div>
            <button
              className={`send-btn${loading ? ' loading' : ''}`}
              disabled={!canSend || loading}
              aria-busy={loading}
              onClick={send}
            >{loading ? '发送中…' : '发送'}</button>
          </div>
        </div>
      </div>
    </>
  );
}
