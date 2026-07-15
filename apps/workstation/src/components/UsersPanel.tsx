import React from 'react';
import Icon from '../ui/Icon.js';

/** 用户管理：占位页，功能待开发。 */
export default function UsersPanel() {
  return (
    <main className="panel-page">
      <div className="panel-toolbar">
        <div className="toolbar-left">
          <h2 className="block-title">用户管理</h2>
        </div>
      </div>
      <div className="empty">
        <Icon name="zap" size={28} style={{ opacity: .4, marginBottom: 4 }} />
        功能开发中，敬请期待
      </div>
    </main>
  );
}
