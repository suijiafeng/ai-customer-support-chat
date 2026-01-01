import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBooleanEnv } from '../server/config.js';

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
