import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpdateChecker, newerVersion } from './updates.ts';

test('stable release comparison handles multi-digit versions and never suggests downgrades', () => {
  assert.equal(newerVersion('1.10.0', '1.9.9'), true);
  assert.equal(newerVersion('2.0.0', '1.99.99'), true);
  for (const version of ['1.0.0', '0.9.9', '1.0.1-beta', 'v1.0.1', '01.1.1', 'not-a-version'])
    assert.equal(newerVersion(version, '1.0.0'), false);
});
test('update checks use only fixed public metadata, coalesce requests and cache/rate limit manual checks', async () => {
  let calls = 0,
    now = 0;
  const request = async (url: unknown, init?: RequestInit) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/Sebastian-Vetter/Chat-for-Pi/releases/latest');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    return Response.json({
      tag_name: 'v1.10.0',
      body: 'Release notes',
      html_url: 'https://attacker.example',
      assets: [
        { name: 'pi-chat-extension-1.10.0.tgz', browser_download_url: 'https://attacker.example' },
      ],
    });
  };
  const checker = new UpdateChecker('1.9.0', true, request as typeof fetch, () => now);
  const [a, b] = await Promise.all([checker.check(), checker.check()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  assert.equal(a.status, 'available');
  assert.equal(a.notes, 'Release notes');
  assert.equal(
    a.releaseUrl,
    'https://github.com/Sebastian-Vetter/Chat-for-Pi/releases/tag/v1.10.0',
  );
  assert.match(a.downloadUrl!, /pi-chat-extension-1.10.0.tgz$/);
  await checker.check(true);
  assert.equal(calls, 1);
  now = 61000;
  await checker.check();
  assert.equal(calls, 1);
  await checker.check(true);
  assert.equal(calls, 2);
  now += 3600001;
  await checker.check();
  assert.equal(calls, 3);
});
test('offline, unpublished, rate-limited, malformed, prerelease and disabled checks fail safely', async () => {
  const responses = [
    () => {
      throw new Error('offline');
    },
    () => new Response(null, { status: 403 }),
    () => new Response('not json'),
    () => Response.json({ tag_name: 'v2.0.0', prerelease: true }),
    () => Response.json({ tag_name: 'v../../malicious' }),
    () => Response.json({ tag_name: '2.0.0' }),
    () => new Response('x'.repeat(1024 * 1024 + 1)),
  ];
  for (const response of responses) {
    const checker = new UpdateChecker('1.0.0', true, (async () => response()) as typeof fetch);
    const result = await checker.check();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.downloadUrl, undefined);
  }
  assert.equal(
    (
      await new UpdateChecker(
        '1.0.0',
        true,
        (async () => new Response(null, { status: 404 })) as typeof fetch,
      ).check()
    ).status,
    'unpublished',
  );
  assert.equal(
    (
      await new UpdateChecker('1.0.0', false, (async () => {
        throw new Error('must not call');
      }) as typeof fetch).check()
    ).status,
    'disabled',
  );
  for (const current of ['1.0.0', '2.0.0'])
    assert.equal(
      (
        await new UpdateChecker(current, true, (async () =>
          Response.json({ tag_name: 'v1.0.0' })) as typeof fetch).check()
      ).status,
      'current',
    );
});
