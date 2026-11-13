import test from 'node:test';
import assert from 'node:assert/strict';
import { PRICING, runCost } from '../src/pricing.js';

test('a run costs 10 plus 5 per started second, at most 25', () => {
  assert.equal(runCost(1), 15);
  assert.equal(runCost(1000), 15);
  assert.equal(runCost(1001), 20);
  assert.equal(runCost(3000), 25);
  assert.equal(runCost(12_300), 25);
  assert.equal(runCost(60_000), 25);
});
test('minimum balance covers a one-second run', () => {
  assert.equal(PRICING.minToRun, runCost(1000));
});
