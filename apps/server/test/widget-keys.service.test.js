import test from 'node:test';
import assert from 'node:assert/strict';
import { WidgetKeysService } from '../dist/widget-keys/widget-keys.service.js';

function fakeStore(widgetKeys = []) {
  const saved = [];
  const deleted = [];
  return {
    saved,
    deleted,
    getPersisted: () => ({ sessions: [], conversations: [], tickets: [], widgetKeys }),
    saveWidgetKey: (key) => { saved.push(key); },
    deleteWidgetKey: (key) => { deleted.push(key); },
  };
}

test('空表启动时自动种一个 demo-site 密钥（启用状态）', () => {
  const store = fakeStore([]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  const keys = svc.list();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].key, 'demo-site');
  assert.equal(keys[0].active, true);
  assert.equal(store.saved.length, 1);
});

test('表非空时不重复种子', () => {
  const store = fakeStore([
    { key: 'acme', name: 'Acme', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  assert.equal(svc.list().length, 1);
  assert.equal(svc.list()[0].key, 'acme');
  assert.equal(store.saved.length, 0);
});

test('isValid 对存在且启用的 key 返回 true', () => {
  const store = fakeStore([
    { key: 'acme', name: 'Acme', active: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  assert.equal(svc.isValid('acme'), true);
});

test('isValid 对不存在、停用、空值的 key 返回 false', () => {
  const store = fakeStore([
    { key: 'acme', name: 'Acme', active: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  assert.equal(svc.isValid('acme'), false); // 停用
  assert.equal(svc.isValid('unknown'), false); // 不存在
  assert.equal(svc.isValid(null), false);
  assert.equal(svc.isValid(undefined), false);
  assert.equal(svc.isValid(''), false);
});

test('create 成功创建并写穿透', () => {
  const store = fakeStore([{ key: 'demo-site', name: 'seed', active: true, createdAt: 'x', updatedAt: 'x' }]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  const created = svc.create('acme-corp', 'Acme Corp');
  assert.equal(created.key, 'acme-corp');
  assert.equal(created.name, 'Acme Corp');
  assert.equal(created.active, true);
  assert.equal(svc.isValid('acme-corp'), true);
  assert.equal(store.saved.at(-1).key, 'acme-corp');
});

test('create 对已存在的 key 抛出冲突异常', () => {
  const store = fakeStore([{ key: 'acme', name: 'Acme', active: true, createdAt: 'x', updatedAt: 'x' }]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  assert.throws(() => svc.create('acme', '重复'));
});

test('setActive 切换启用状态并写穿透', () => {
  const store = fakeStore([{ key: 'acme', name: 'Acme', active: true, createdAt: 'x', updatedAt: 'x' }]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  const updated = svc.setActive('acme', false);
  assert.equal(updated.active, false);
  assert.equal(svc.isValid('acme'), false);
});

test('setActive 对不存在的 key 抛出异常', () => {
  const store = fakeStore([]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit(); // 种子 demo-site

  assert.throws(() => svc.setActive('unknown', true));
});

test('remove 删除已存在的 key 并写穿透删除', () => {
  const store = fakeStore([{ key: 'acme', name: 'Acme', active: true, createdAt: 'x', updatedAt: 'x' }]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  svc.remove('acme');
  assert.equal(svc.isValid('acme'), false);
  assert.equal(store.deleted.at(-1), 'acme');
});

test('remove 对不存在的 key 抛出异常', () => {
  const store = fakeStore([]);
  const svc = new WidgetKeysService(store);
  svc.onModuleInit();

  assert.throws(() => svc.remove('unknown'));
});
