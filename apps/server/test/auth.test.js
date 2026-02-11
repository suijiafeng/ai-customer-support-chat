import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken, hashPassword, verifyPassword } from '../dist/auth/jwt.js';

const SECRET = 'test-secret';

test('signToken 签发的 token 可被 verifyToken 验证并还原身份', () => {
  const token = signToken({ sub: '9527', name: '客服9527' }, SECRET);
  const claims = verifyToken(token, SECRET);
  assert.equal(claims.sub, '9527');
  assert.equal(claims.name, '客服9527');
  assert.ok(claims.exp > Date.now() / 1000);
});

test('篡改或错误密钥的 token 验证失败', () => {
  const token = signToken({ sub: '9527', name: '客服9527' }, SECRET);
  assert.equal(verifyToken(token, 'wrong-secret'), null);
  assert.equal(verifyToken(token.slice(0, -2) + 'xx', SECRET), null);
  assert.equal(verifyToken('not-a-token', SECRET), null);
});

test('过期 token 验证失败', () => {
  const token = signToken({ sub: '9527', name: '客服9527' }, SECRET, -1);
  assert.equal(verifyToken(token, SECRET), null);
});

test('verifyPassword 校验 scrypt 哈希', () => {
  const hash = hashPassword('123456', 'somesalt');
  assert.equal(verifyPassword('123456', 'somesalt', hash), true);
  assert.equal(verifyPassword('wrong', 'somesalt', hash), false);
});
