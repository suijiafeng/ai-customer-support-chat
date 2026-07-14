import React from 'react';
import type { AgentIdentity } from '../api.js';
import MetricsPanel from './MetricsPanel.js';
import TicketsPanel from './TicketsPanel.js';

interface OperationsPanelProps {
  agent: AgentIdentity;
  onOpenSession: (sessionId: string) => void;
}

/** 数据概览：数据看板 + 跟进事项（原独立页签）合并成的单页。 */
export default function OperationsPanel({ agent, onOpenSession }: OperationsPanelProps) {
  return (
    <main className="panel-page">
      <MetricsPanel />
      <TicketsPanel agent={agent} onOpenSession={onOpenSession} />
    </main>
  );
}
