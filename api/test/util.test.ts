import test from 'node:test';
import assert from 'node:assert/strict';
import { extractCode, safeFilename, hasAllowedExt, sha256 } from '../src/util.js';

test('extractCode pulls the fenced block', () => {
  assert.equal(extractCode('Here:\n```python\nprint(1)\n```\nbye'), 'print(1)');
});
test('extractCode returns plain text when there is no fence', () => {
  assert.equal(extractCode('  print(2) '), 'print(2)');
});
test('safeFilename strips paths and odd characters', () => {
  assert.equal(safeFilename('../../etc/pass wd?.csv'), 'pass wd_.csv');
});
test('hasAllowedExt', () => {
  assert.ok(hasAllowedExt('Data.CSV'));
  assert.ok(!hasAllowedExt('run.exe'));
});
test('sha256 is stable', () => {
  assert.equal(sha256('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});
