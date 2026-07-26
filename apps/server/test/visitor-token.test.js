// 访客会话凭证测试：绑定 sessionId、不可跨会话复用、与客服 token 不可互换。
import test from 'node:test';
import assert from 'node:assert/strict';
import { signVisitorToken, verifyVisitorToken } from '../dist/auth/visitor-token.js';
import { signToken, signSseTicket } from '../dist/auth/jwt.js';

const SECRET = 'test-secret';
const SID = 'v-abc123';

test('签发的令牌可以校验通过', () => {
  const token = signVisitorToken(SID, SECRET);
  assert.equal(verifyVisitorToken(token, SID, SECRET), true);
});

test('令牌只对签发它的那个会话有效——这是本次修复的核心', () => {
  const token = signVisitorToken(SID, SECRET);
  assert.equal(verifyVisitorToken(token, 'v-someone-else', SECRET), false);
});

test('换密钥、篡改签名、篡改载荷都无法通过', () => {
  const token = signVisitorToken(SID, SECRET);
  assert.equal(verifyVisitorToken(token, SID, 'wrong-secret'), false);
  assert.equal(verifyVisitorToken(token.slice(0, -2) + 'xx', SID, SECRET), false);

  // 把载荷里的 sub 换成别的会话再拼回去（签名必然对不上）
  const [h, b, s] = token.split('.');
  const tampered = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  tampered.sub = 'v-someone-else';
  const forged = `${h}.${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${s}`;
  assert.equal(verifyVisitorToken(forged, 'v-someone-else', SECRET), false);
});

test('客服 token 与 SSE 票据不能冒充访客令牌（kind 隔离）', () => {
  const agentToken = signToken({ sub: SID, name: '客服9527', role: 'admin' }, SECRET);
  assert.equal(verifyVisitorToken(agentToken, SID, SECRET), false);

  const ticket = signSseTicket({ sub: SID, name: '客服9527', role: 'admin' }, SECRET);
  assert.equal(verifyVisitorToken(ticket, SID, SECRET), false);
});

test('过期令牌不再有效', () => {
  const expired = signVisitorToken(SID, SECRET, -1);
  assert.equal(verifyVisitorToken(expired, SID, SECRET), false);
});

test('空值与畸形输入一律拒绝，且不抛异常', () => {
  for (const bad of [undefined, null, '', 'not-a-token', 'a.b', 'a.b.c.d', '..']) {
    assert.equal(verifyVisitorToken(bad, SID, SECRET), false, String(bad));
  }
});

test('签名长度不同也不会让 timingSafeEqual 抛异常', () => {
  // timingSafeEqual 在两侧长度不等时会 throw，实现里必须先比长度
  assert.doesNotThrow(() => verifyVisitorToken('a.b.short', SID, SECRET));
  assert.equal(verifyVisitorToken('a.b.short', SID, SECRET), false);
});
