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

test('图片附件本体不入本地存储（落盘降级占位）；乐观临时消息（无 actor）跳过', () => {
  const storage = fakeStorage();
  const archive = createMessageArchive(storage, 'ns');
  archive.merge('s1', [
    { ...msg('1', ''), attachments: [{ dataUrl: 'data:image/png;base64,xxx' }] },
    { id: 'tmp', from: 'customer', content: '乐观渲染' },
  ]);
  // 落盘的归档是精简版：不含图片本体，降级为 [图片] 占位
  const stored = archive.load('s1');
  assert.equal(stored.length, 1); // 无 actor 的乐观消息不入档
  assert.equal(stored[0].content, '[图片]');
  assert.equal(stored[0].hasAttachments, true);
  assert.ok(!JSON.stringify([...storage._map.values()]).includes('base64'));
});

test('渲染返回值：窗口内消息保留原始图片附件，避免合并后丢图', () => {
  const archive = createMessageArchive(fakeStorage(), 'ns');
  const withImg = { ...msg('1', ''), attachments: [{ dataUrl: 'data:image/png;base64,xxx' }] };
  const merged = archive.merge('s1', [withImg]);
  // 仍在服务端窗口内的消息透传原对象：附件本体在渲染数据里保留
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].attachments, [{ dataUrl: 'data:image/png;base64,xxx' }]);
});

test('渲染返回值：仅窗口外的旧消息用归档占位（不含附件）', () => {
  const archive = createMessageArchive(fakeStorage(), 'ns', { maxMessages: 100 });
  // 先归档一条带图旧消息
  archive.merge('s1', [{ ...msg('1', ''), attachments: [{ dataUrl: 'data:image/png;base64,old' }] }]);
  // 下一批服务端窗口已不含 id=1，只有 2、3
  const merged = archive.merge('s1', [msg('2', 'b'), msg('3', 'c')]);
  assert.deepEqual(merged.map((m) => m.id), ['1', '2', '3']);
  const old = merged.find((m) => m.id === '1');
  assert.equal(old.content, '[图片]'); // 窗口外旧消息降级为占位
  assert.ok(!old.attachments); // 其附件本体本就不在本地
});

test('无 storage（隐私模式等）时不抛错，仅返回本批消息', () => {
  const archive = createMessageArchive(undefined, 'ns');
  const merged = archive.merge('s1', [msg('1', 'a')]);
  assert.equal(merged.length, 1);
});
