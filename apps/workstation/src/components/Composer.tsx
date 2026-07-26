import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@assistflow/shared';
import {
  ApiError, requestJson, fileToDataUrl, normalizeMessages, MAX_ATTACHMENTS, MAX_IMAGE_BYTES,
  type AgentIdentity, type PendingAttachment, type UiMessage,
} from '../api.js';
import { showToast } from '../ui/feedback.js';
import Icon from '../ui/Icon.js';
import EmojiPicker from './EmojiPicker.js';

// 客服常用语：按接待环节分组，覆盖开场→澄清→报价→跟进→收尾的完整链路。
// 用「[]」标出需要客服自己替换的占位内容，避免直接发出去露馅。
const CANNED_GROUPS: Array<{ label: string; items: string[] }> = [
  {
    label: '开场接入',
    items: [
      '您好，我是客服[工号]，很高兴为您服务，请问有什么可以帮您？',
      '您好，看到您的留言了，我来跟进这个问题。',
      '不好意思让您久等了，我这就为您处理。',
    ],
  },
  {
    label: '需求澄清',
    items: [
      '为了更准确地帮您评估，能否补充一下：项目类型、主要功能、期望上线时间？',
      '我确认一下，您的意思是[复述需求]，对吗？',
      '方便提供一下相关截图或链接吗？这样我能更快定位问题。',
    ],
  },
  {
    label: '报价与合作',
    items: [
      '报价需要结合功能范围和周期来定，我先根据您的描述整理一份清单，稍后同步给您。',
      '这个需求可以做，大致周期在[X]，具体排期我确认后回复您。',
      '合作流程是：需求沟通 → 方案报价 → 确认排期 → 分阶段开发验收 → 交付维护。',
    ],
  },
  {
    label: '处理与等待',
    items: [
      '收到，我先确认一下，请稍等。',
      '这个问题我需要核实后回复您，预计[X 分钟/小时]内给您答复，麻烦您稍等。',
      '感谢您的耐心等待，我这边还在确认，一有结果马上告诉您。',
    ],
  },
  {
    label: '记录与转交',
    items: [
      '请留下您的称呼和联系方式，我们会尽快跟进。',
      '该问题已记录为跟进事项，会有专人与您联系。',
      '这个问题需要[技术/商务]同事进一步确认，我先帮您转交，稍后由他跟您联系。',
    ],
  },
  {
    label: '致歉与安抚',
    items: [
      '非常抱歉给您带来不便，我理解您的心情，这边马上帮您处理。',
      '给您造成困扰实在不好意思，问题原因是[原因]，我们已经在处理了。',
    ],
  },
  {
    label: '收尾结束',
    items: [
      '问题都解决了吗？还有其他需要帮忙的吗？',
      '感谢咨询，如还有问题随时联系我们，祝您生活愉快！',
      '那我先不打扰您了，有任何进展我会第一时间同步给您。',
    ],
  },
];

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
  const composerEl = useRef<HTMLDivElement | null>(null);

  // 点击 Composer 区域外部时关闭表情/快捷回复弹出层
  useEffect(() => {
    if (!showEmoji && !showCanned) return;
    const onDown = (e: MouseEvent) => {
      if (!composerEl.current?.contains(e.target as Node)) {
        setShowEmoji(false);
        setShowCanned(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showEmoji, showCanned]);

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

  const toggleEmoji = useCallback(() => {
    setShowEmoji((v) => {
      if (!v) setShowCanned(false);
      return !v;
    });
  }, []);

  const handleEmojiSelect = useCallback((emoji: string) => {
    setReply((r) => r + emoji);
    setShowEmoji(false);
    requestAnimationFrame(() => replyInput.current?.focus());
  }, []);

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
    } catch (err) {
      // 409：发送瞬间该客户已被其他客服抢先接待
      const conflict = err instanceof ApiError && err.status === 409;
      showToast(conflict ? '该客户已被其他客服抢先接待，无法回复' : '消息发送失败，请重试', 'error');
    } finally {
      setLoading(false);
      requestAnimationFrame(() => replyInput.current?.focus());
    }
  }, [reply, pending, sessionId, loading, onSent]);

  // 快捷回复：常用语一键插入输入框
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
    <div ref={composerEl} style={{ display: 'contents' }}>
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
          <EmojiPicker onSelect={handleEmojiSelect} />
        </div>
      )}

      {showCanned && (
        <div className="canned-pop" role="menu" aria-label="快捷回复">
          {CANNED_GROUPS.map((group) => (
            <div key={group.label} className="canned-group" role="group" aria-label={group.label}>
              <div className="canned-group-label">{group.label}</div>
              {group.items.map((text) => (
                <button key={text} role="menuitem" onClick={() => insertCanned(text)}>{text}</button>
              ))}
            </div>
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
                onClick={toggleEmoji}
              ><Icon name="smile" size={16} /></button>
              <button
                type="button"
                className={`tool${showCanned ? ' active' : ''}`}
                title="快捷回复"
                aria-label="快捷回复"
                aria-pressed={showCanned}
                onClick={() => { setShowCanned((v) => !v); setShowEmoji(false); }}
              ><Icon name="zap" size={16} /></button>
              <input ref={fileEl} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
              <span className="key-hint">Shift + Enter 换行</span>
            </div>
            <button
              className={`send-btn${loading ? ' loading' : ''}`}
              disabled={!canSend || loading}
              aria-busy={loading}
              onClick={send}
            >{loading ? '发送中…' : <><Icon name="send" size={14} />发送</>}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
