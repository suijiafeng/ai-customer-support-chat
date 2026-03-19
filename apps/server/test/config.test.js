import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooleanEnv, parseTrustProxy } from '../dist/config.js';

test('parseBooleanEnv defaults to enabled', () => {
  assert.equal(parseBooleanEnv(undefined), true);
  assert.equal(parseBooleanEnv(''), true);
});

test('parseBooleanEnv supports common enabled and disabled values', () => {
  assert.equal(parseBooleanEnv('true'), true);
  assert.equal(parseBooleanEnv('1'), true);
  assert.equal(parseBooleanEnv('on'), true);
  assert.equal(parseBooleanEnv('false'), false);
  assert.equal(parseBooleanEnv('0'), false);
  assert.equal(parseBooleanEnv('off'), false);
});

test('parseBooleanEnv uses the provided default for invalid values', () => {
  assert.equal(parseBooleanEnv('invalid', false), false);
});

test('parseTrustProxy defaults to false when unset (direct deployment, anti-spoof)', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('   '), false);
});

test('parseTrustProxy parses hop count, booleans and presets', () => {
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('2'), 2);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
});
