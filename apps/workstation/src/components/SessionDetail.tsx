import React, { useState } from 'react';
import type { SessionSummary, Ticket } from '@assistflow/shared';
import { requestJson, statusTag, statusText } from '../api.js';

const SENTIMENT_TEXT: Record<string, string> = { positive: '😊 积极', neutral: '😐 中性', negative: '😟 消极' };
const TICKET_STATUS: Record<string, string> = { open: '待处理', processing: '处理中', resolved: '已解决' };

interface SessionDetailProps {
  session: SessionSummary;
  onClose: () => void;
}

/** 会话详情侧栏：访客资料、AI 诊断、关联工单、标记解决。 */
export default function SessionDetail({ session, onClose }: SessionDetailProps) {
  const [resolving, setResolving] = useState(false);
  const wf = session.workflow;
  const ticket: Ticket | null = wf?.ticket || null;

  const resolve = async () => {
    if (resolving || session.status === 'closed') return;
    if (!window.confirm('确认将该会话标记为已解决？关联跟进事项会一并解决。')) return;
    setResolving(true);
    try {
      await requestJson(`/api/sessions/${encodeURIComponent(session.sessionId)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: '客服标记解决' }),
      });
      // 会话状态经 SSE 推送回队列，无需本地改状态
    } catch {
      alert('操作失败，请重试');
    } finally {
      setResolving(false);
    }
  };

  return (
    <aside className="detail-pane" aria-label="会话详情">
      <div className="detail-head">
        <span>会话详情</span>
        <button className="detail-close" aria-label="收起详情" onClick={onClose}>×</button>
      </div>
      <div className="detail-scroll">
        <section>
          <h4>访客</h4>
          <dl>
            <div><dt>名称</dt><dd>{session.displayName}</dd></div>
            {session.profile?.contact && <div><dt>联系方式</dt><dd>{session.profile.contact}</dd></div>}
            {session.visitor?.code && <div><dt>访客标识</dt><dd className="mono">{session.visitor.code}</dd></div>}
            <div><dt>会话状态</dt><dd><span className={`tag tag-${statusTag(session.status)}`}>{statusText(session.status)}</span></dd></div>
            <div><dt>优先级</dt><dd>{session.priority === 'high' ? '🔥 高' : '普通'}</dd></div>
            <div><dt>消息数</dt><dd>{session.messageCount}</dd></div>
          </dl>
        </section>

        {wf && (
          <section>
            <h4>AI 诊断</h4>
            <dl>
              <div><dt>最近意图</dt><dd>{wf.intent}</dd></div>
              <div><dt>情绪</dt><dd>{SENTIMENT_TEXT[wf.sentiment] || wf.sentiment}</dd></div>
              <div><dt>需要人工</dt><dd>{wf.needHuman ? '是' : '否'}</dd></div>
              {wf.reason && <div><dt>判定原因</dt><dd>{wf.reason}</dd></div>}
              <div><dt>AI 回复</dt><dd>{wf.ai?.used ? `${wf.ai.provider} ${wf.ai.model}` : '本地规则'}</dd></div>
            </dl>
            {wf.sources?.length > 0 && (
              <div className="faq-sources">
                <span className="sources-label">命中知识库</span>
                {wf.sources.map((s) => (
                  <div key={s.id} className="faq-source">{s.question}<i>{s.score}</i></div>
                ))}
              </div>
            )}
          </section>
        )}

        {wf?.inquiry && (
          <section>
            <h4>关联咨询</h4>
            <dl>
              <div><dt>编号</dt><dd className="mono">{wf.inquiry.id}</dd></div>
              <div><dt>标题</dt><dd>{wf.inquiry.title}</dd></div>
              <div><dt>状态</dt><dd>{wf.inquiry.statusText}</dd></div>
            </dl>
          </section>
        )}

        {ticket && (
          <section>
            <h4>跟进事项</h4>
            <dl>
              <div><dt>编号</dt><dd className="mono">{ticket.id}</dd></div>
              <div><dt>状态</dt><dd>{TICKET_STATUS[ticket.status] || ticket.status}</dd></div>
              <div><dt>事由</dt><dd>{ticket.reason}</dd></div>
            </dl>
          </section>
        )}
      </div>
      <div className="detail-foot">
        <button
          className="resolve-btn"
          disabled={session.status === 'closed' || resolving}
          onClick={resolve}
        >
          {session.status === 'closed' ? '会话已关闭' : resolving ? '处理中…' : '✓ 标记解决'}
        </button>
      </div>
    </aside>
  );
}
