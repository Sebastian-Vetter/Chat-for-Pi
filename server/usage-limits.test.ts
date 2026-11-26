import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageLimitChecker, parseUsage } from './usage-limits.js';

const codex = {
  rate_limit: {
    primary_window: { used_percent: 25, limit_window_seconds: 18000, reset_at: 1800000000 },
    secondary_window: { used_percent: 70, limit_window_seconds: 604800, reset_at: 1800500000 },
  },
  email: 'must-not-reach-browser@example.invalid',
};
const token = `header.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'account-test' } })).toString('base64url')}.secret`;
const runtime = {
  checkAuth: async () => ({ type: 'oauth' as const }),
  getAuth: async () => ({ auth: { apiKey: token } }),
};

test('usage windows use provider-reported percentages and durations, never chat token estimates', () => {
  const result = parseUsage('openai-codex', codex);
  assert.equal(result.fiveHour?.usedPercent, 25);
  assert.equal(result.weekly?.usedPercent, 70);
  assert.equal(result.fiveHour?.resetsAt, new Date(1800000000000).toISOString());
  assert.deepEqual(
    parseUsage('openai-codex', {
      rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 3600 } },
    }),
    { fiveHour: undefined, weekly: undefined },
  );
  const claude = parseUsage('anthropic', {
    five_hour: { utilization: 12.5, resets_at: '2026-12-01T12:00:00Z' },
    seven_day: { utilization: 45 },
  });
  assert.equal(claude.fiveHour?.usedPercent, 12.5);
  assert.equal(claude.weekly?.usedPercent, 45);
  for (const value of [
    null,
    'bad',
    {},
    { five_hour: { utilization: '90' } },
    { five_hour: { utilization: 110 } },
  ])
    assert.equal(parseUsage('anthropic', value).fiveHour, undefined);
});

test('usage metadata requests use fixed endpoints, private server-side OAuth, bounded caching and coalescing', async () => {
  let calls = 0;
  let now = 1800000000000;
  const checker = new UsageLimitChecker(
    Promise.resolve(runtime),
    true,
    async (url, init) => {
      calls++;
      assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
      assert.equal(init?.redirect, 'error');
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${token}`);
      assert.equal((init?.headers as Record<string, string>)['ChatGPT-Account-Id'], 'account-test');
      assert.equal(init?.body, undefined);
      return Response.json(codex);
    },
    () => now,
  );
  const [first, second] = await Promise.all([
    checker.check('openai-codex'),
    checker.check('openai-codex'),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.status, 'ok');
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(first), /secret|account-test|must-not-reach-browser/);
  await checker.check('openai-codex');
  assert.equal(calls, 1);
  now += 60001;
  await checker.check('openai-codex');
  assert.equal(calls, 2);
});

test('disabled, API-key, failed, malformed, oversized and redirected usage checks never fabricate allowances', async () => {
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error(`private ${token}`);
  };
  assert.equal(
    (await new UsageLimitChecker(Promise.resolve(runtime), false, fail).check('anthropic')).status,
    'disabled',
  );
  const apiKeyRuntime = { ...runtime, checkAuth: async () => ({ type: 'api_key' as const }) };
  assert.equal(
    (await new UsageLimitChecker(Promise.resolve(apiKeyRuntime), true, fail).check('anthropic'))
      .status,
    'signin-required',
  );
  assert.equal(calls, 0);
  for (const fetcher of [
    fail,
    async () => new Response('private', { status: 403 }),
    async () => Response.json({}),
    async () => new Response('x'.repeat(300000)),
    async () => new Response('{broken'),
  ]) {
    const value = await new UsageLimitChecker(Promise.resolve(runtime), true, fetcher).check(
      'anthropic',
    );
    assert.equal(value.status, 'unavailable');
    assert.equal(value.fiveHour, undefined);
    assert.equal(value.weekly, undefined);
    assert.doesNotMatch(JSON.stringify(value), /secret|private/);
  }
});
