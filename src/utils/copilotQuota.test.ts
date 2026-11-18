import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_COPILOT_WARNINGS,
  consumeCopilotUsage,
  createInitialCopilotUsage,
  isCopilotLowQuota,
} from './copilotQuota';

test('tracks Copilot usage and stops emitting warnings after exactly 5 warnings', () => {
  let usage = createInitialCopilotUsage(10, 1000);
  const emittedWarnings = [];

  for (let i = 0; i < 10; i++) {
    const res = consumeCopilotUsage(usage, undefined, 1000 + i * 100);
    usage = res.nextUsage;
    if (res.warning) {
      emittedWarnings.push(res.warning);
    }
  }

  assert.equal(usage.used, 10);
  assert.equal(usage.remaining, 0);
  assert.equal(emittedWarnings.length, MAX_COPILOT_WARNINGS);
  assert.equal(usage.warningsShown, 5);
  assert.deepEqual(
    emittedWarnings.map((w) => w.warningNumber),
    [1, 2, 3, 4, 5]
  );
  assert.match(emittedWarnings[0].message, /limite do GitHub Copilot está acabando/i);
  assert.equal(isCopilotLowQuota(usage), true);

  // An extra call past limit must NEVER emit a 6th warning
  const extra = consumeCopilotUsage(usage, undefined, 5000);
  assert.equal(extra.warning, null);
  assert.equal(extra.nextUsage.warningsShown, 5);
  assert.equal(extra.limitReached, true);
});

test('syncs with GitHub rate-limit headers and triggers warning when <= 5 remaining', () => {
  const initial = createInitialCopilotUsage(50, 1000);
  const synced = consumeCopilotUsage(
    initial,
    { limit: 150, remaining: 4, resetAt: 999999 },
    2000
  );

  assert.equal(synced.nextUsage.source, 'github-headers');
  assert.equal(synced.nextUsage.limit, 150);
  assert.equal(synced.nextUsage.remaining, 4);
  assert.equal(synced.nextUsage.used, 146);
  assert.ok(synced.warning);
  assert.equal(synced.warning?.warningNumber, 1);
  assert.equal(synced.warning?.remaining, 4);
});
