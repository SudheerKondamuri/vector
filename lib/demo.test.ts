import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_STATE, advanceBounty, createBounty, parseSavedState, validateBounty } from './demo.ts';

test('seed includes a bounty with a meaningful reward and stage', () => {
  const bounty = INITIAL_STATE.bounties.find((item) => item.id === 'eth-usdc-route');
  assert.equal(bounty?.reward, 2400);
  assert.equal(bounty?.stage, 'open');
});

test('validation rejects invalid reward and short copy', () => {
  const errors = validateBounty({ title: 'tiny', description: 'not enough', category: 'DeFi', reward: 2, duration: 4 });
  assert.ok(errors.title && errors.description && errors.reward && errors.duration);
});

test('connected owner can create a bounty and advance it', () => {
  const connected = { ...INITIAL_STATE, walletConnected: true };
  const created = createBounty(connected, { title: 'Find a safer bridge route', description: 'Compare routes and return the one with the lowest simulated risk score.', category: 'DeFi', reward: 500, duration: 12 }, 'test-bounty', 100);
  assert.equal(created.bounties[0].id, 'test-bounty');
  const progressed = advanceBounty(created, 'test-bounty', 101);
  assert.equal(progressed.bounties[0].stage, 'committed');
});

test('invalid or future saved data gets a clean deterministic state', () => {
  assert.deepEqual(parseSavedState('{"version":99}'), INITIAL_STATE);
  assert.deepEqual(parseSavedState('nope'), INITIAL_STATE);
});
