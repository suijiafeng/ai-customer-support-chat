import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageArchive } from '../../../packages/shared/dist/index.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const msg = (id, content, extra = {}) => ({
  id, role: 'user', actor: 'customer', content,
  attachments: [], createdAt: new Date(2026, 0, 1, 0, 0, Number(id)).toISOString(), ...extra,
});

test('归档合并：服务端窗口滑走的旧消息仍保留在本地时间线', () => {
  const archive = createMessageArchive(fakeStorage(), 'ns', { maxMessages: 100 });
  archive.merge('s1', [msg('1', 'a'), msg('2', 'b')]);
  // 服务端窗口只剩下后两条（1 被裁掉），合并后仍是完整 3 条
  const merged = archive.merge('s1', [msg('2', 'b'), msg('3', 'c')]);
  assert.deepEqual(merged.map((m) => m.id), ['1', '2', '3']);
});

test('归档去重并以服务端最新版本覆盖', () => {
  const archive = createMessageArchive(fakeStorage(), 'ns');
  archive.merge('s1', [msg('1', 'old')]);
  const merged = archive.merge('s1', [msg('1', 'new')]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, 'new');
});

test('每会话条数上限：超出裁掉最早的', () => {
  const archive = createMessageArchive(fakeStorage(), 'ns', { maxMessages: 2 });
  const merged = archive.merge('s1', [msg('1', 'a'), msg('2', 'b'), msg('3', 'c')]);
  assert.deepEqual(merged.map((m) => m.id), ['2', '3']);
});

test('LRU 会话上限：最久未活跃的会话归档被清除', () => {
  const storage = fakeStorage();
  const archive = createMessageArchive(storage, 'ns', { maxSessions: 2 });
  archive.merge('s1', [msg('1', 'a')]);
  archive.merge('s2', [msg('2', 'b')]);
  archive.merge('s3', [msg('3', 'c')]);
  assert.equal(archive.load('s1').length, 0);
  assert.equal(archive.load('s3').length, 1);
});

test('图片附件不入档，降级为占位文本；乐观临时消息（无 actor）跳过', () => {
  const archive = createMessageArchive(fakeStorage(), 'ns');
  const merged = archive.merge('s1', [
    { ...msg('1', ''), attachments: [{ dataUrl: 'data:image/png;base64,xxx' }] },
    { id: 'tmp', from: 'customer', content: '乐观渲染' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].content, '[图片]');
  assert.equal(merged[0].hasAttachments, true);
  assert.ok(!JSON.stringify(merged).includes('base64'));
});

test('无 storage（隐私模式等）时不抛错，仅返回本批消息', () => {
  const archive = createMessageArchive(undefined, 'ns');
  const merged = archive.merge('s1', [msg('1', 'a')]);
  assert.equal(merged.length, 1);
});
