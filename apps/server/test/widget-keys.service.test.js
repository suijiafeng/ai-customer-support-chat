import test from 'node:test';
import assert from 'node:assert/strict';
import { WidgetKeysService } from '../dist/widget-keys/widget-keys.service.js';

// 租户密钥格式：16 位大小写字母+数字，4 位一组用 - 分隔
const KEY_PATTERN = /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/;
const ID_PATTERN = /^tn_[0-9a-f]{10}$/;

function fakeStore(widgetKeys = []) {
  const saved = [];
  const deleted = [];
  return {
    saved,
    deleted,
    // onModuleInit 会先 await 快照就绪信号（见 StoreService.whenReady）
    whenReady: Promise.resolve(),
    getPersisted: () => ({ sessions: [], conversations: [], tickets: [], widgetKeys }),
    saveWidgetKey: (key) => { saved.push(key); },
    deleteWidgetKey: (key) => { deleted.push(key); },
  };
}

async function makeService(widgetKeys = []) {
  const store = fakeStore(widgetKeys);
  const svc = new WidgetKeysService(store);
  await svc.onModuleInit();
  return { svc, store };
}

const row = (extra = {}) => ({
  id: 'tn_1234567890',
  key: 'acme',
  name: 'Acme',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

test('空表启动时自动种一个 demo 租户（固定ID与密钥、启用状态）', async () => {
  const { svc, store } = await makeService([]);

  const keys = svc.list();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].key, 'd0KX6-CDtI-Gaxc-fR1K');
  assert.equal(keys[0].id, 'tn_846ad88eee');
  assert.equal(keys[0].active, true);
  assert.equal(store.saved.length, 1);
});

test('表非空时不重复种子', async () => {
  const { svc, store } = await makeService([row()]);

  assert.equal(svc.list().length, 1);
  assert.equal(svc.list()[0].key, 'acme');
  assert.equal(store.saved.length, 0);
});

test('启动时为缺租户ID的旧数据补齐ID并写穿透', async () => {
  const legacy = row();
  delete legacy.id;
  const { svc, store } = await makeService([legacy]);

  const loaded = svc.list()[0];
  assert.match(loaded.id, ID_PATTERN);
  assert.equal(store.saved.length, 1); // 补齐后落库
  assert.equal(store.saved[0].key, 'acme');
});

test('isValid 对存在且启用的 key 返回 true', async () => {
  const { svc } = await makeService([row()]);
  assert.equal(svc.isValid('acme'), true);
});

test('isValid 对不存在、停用、空值的 key 返回 false', async () => {
  const { svc } = await makeService([row({ active: false })]);

  assert.equal(svc.isValid('acme'), false); // 停用
  assert.equal(svc.isValid('unknown'), false); // 不存在
  assert.equal(svc.isValid(null), false);
  assert.equal(svc.isValid(undefined), false);
  assert.equal(svc.isValid(''), false);
});

test('create 只传名称：自动生成租户ID与新格式密钥并写穿透', async () => {
  const { svc, store } = await makeService([row()]);

  const created = svc.create('Acme Corp', undefined, '备注', 'www.acme.com');
  assert.equal(created.name, 'Acme Corp');
  assert.match(created.id, ID_PATTERN);
  assert.match(created.key, KEY_PATTERN);
  assert.equal(created.remark, '备注');
  assert.equal(created.domain, 'www.acme.com');
  assert.equal(created.active, true);
  assert.equal(svc.isValid(created.key), true);
  assert.equal(store.saved.at(-1).key, created.key);
});

test('create 支持显式指定 key（兼容脚本导入）', async () => {
  const { svc } = await makeService([row()]);

  const created = svc.create('导入站点', 'legacy-site');
  assert.equal(created.key, 'legacy-site');
  assert.equal(svc.isValid('legacy-site'), true);
});

test('create 名称为空抛出异常', async () => {
  const { svc } = await makeService([row()]);
  assert.throws(() => svc.create(''));
  assert.throws(() => svc.create('   '));
});

test('create 对已存在的 key 抛出冲突异常', async () => {
  const { svc } = await makeService([row()]);
  assert.throws(() => svc.create('重复', 'acme'));
});

test('update 切换启用状态并写穿透', async () => {
  const { svc, store } = await makeService([row()]);

  const updated = svc.update('acme', { active: false });
  assert.equal(updated.active, false);
  assert.equal(svc.isValid('acme'), false);
  assert.equal(store.saved.at(-1).active, false);
});

test('update 修改名称/域名/备注，未传字段保持不变', async () => {
  const { svc } = await makeService([row({ remark: '旧备注' })]);

  const updated = svc.update('acme', { name: '新名字', domain: 'new.example.com' });
  assert.equal(updated.name, '新名字');
  assert.equal(updated.domain, 'new.example.com');
  assert.equal(updated.remark, '旧备注'); // 未传保持不变
  assert.equal(updated.active, true);
});

test('update 名称不允许清空', async () => {
  const { svc } = await makeService([row()]);
  assert.throws(() => svc.update('acme', { name: '  ' }));
});

test('update 对不存在的 key 抛出异常', async () => {
  const { svc } = await makeService([]);
  assert.throws(() => svc.update('unknown', { active: true }));
});

test('remove 删除已存在的 key 并写穿透删除', async () => {
  const { svc, store } = await makeService([row()]);

  svc.remove('acme');
  assert.equal(svc.isValid('acme'), false);
  assert.equal(store.deleted.at(-1), 'acme');
});

test('remove 对不存在的 key 抛出异常', async () => {
  const { svc } = await makeService([]);
  assert.throws(() => svc.remove('unknown'));
});

test('verify：密钥无效/停用返回 invalid_site_key', async () => {
  const { svc } = await makeService([row({ active: false })]);

  assert.equal(svc.verify('unknown', 'tn_1234567890', null), 'invalid_site_key');
  assert.equal(svc.verify('acme', 'tn_1234567890', null), 'invalid_site_key'); // 停用
  assert.equal(svc.verify('', 'tn_1234567890', null), 'invalid_site_key');
});

test('verify：租户ID缺失或不匹配返回 invalid_tenant', async () => {
  const { svc } = await makeService([row()]);

  assert.equal(svc.verify('acme', undefined, null), 'invalid_tenant');
  assert.equal(svc.verify('acme', 'tn_wrong', null), 'invalid_tenant');
});

test('verify：未配置域名时不校验来源', async () => {
  const { svc } = await makeService([row()]);

  assert.equal(svc.verify('acme', 'tn_1234567890', null), 'ok');
  assert.equal(svc.verify('acme', 'tn_1234567890', 'anything.com'), 'ok');
});

test('verify：配置域名后校验来源（支持子域名，缺失来源拒绝）', async () => {
  const { svc } = await makeService([row({ domain: 'acme.com' })]);

  assert.equal(svc.verify('acme', 'tn_1234567890', 'acme.com'), 'ok');
  assert.equal(svc.verify('acme', 'tn_1234567890', 'www.acme.com'), 'ok'); // 子域名
  assert.equal(svc.verify('acme', 'tn_1234567890', 'evil.com'), 'domain_not_allowed');
  assert.equal(svc.verify('acme', 'tn_1234567890', 'notacme.com'), 'domain_not_allowed');
  assert.equal(svc.verify('acme', 'tn_1234567890', null), 'domain_not_allowed'); // 无来源头
});

test('verify：租户域名带协议/路径/端口也能归一化匹配', async () => {
  const { svc } = await makeService([row({ domain: 'https://www.acme.com:443/home' })]);

  assert.equal(svc.verify('acme', 'tn_1234567890', 'www.acme.com'), 'ok');
  assert.equal(svc.verify('acme', 'tn_1234567890', 'acme.com'), 'domain_not_allowed');
});
