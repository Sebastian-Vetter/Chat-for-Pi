import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('local API validates requests and persists a chat lifecycle', { timeout: 45000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'pi-chat-api-'));
  const port = 13001;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: {
      ...process.env,
      CHAT_UPDATE_CHECK: '0',
      CHAT_USAGE_CHECK: '0',
      PORT: String(port),
      CHAT_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const base = `http://127.0.0.1:${port}/api`;
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    return fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(logs);
      try {
        if ((await request('/chats')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(ready, logs);
    assert.equal((await (await request('/updates')).json()).status, 'disabled');
    assert.equal(
      (await (await request('/usage-limits/check', 'POST', { provider: 'openai-codex' })).json())
        .status,
      'disabled',
    );
    assert.equal(
      (await request('/usage-limits/check', 'POST', { provider: 'https://evil.example' })).status,
      400,
    );
    assert.equal(
      (
        await request(
          '/usage-limits/check',
          'POST',
          { provider: 'anthropic' },
          { Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    assert.equal((await (await request('/updates/check', 'POST', {})).json()).status, 'disabled');
    assert.equal(
      (await request('/updates/check', 'POST', {}, { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal(
      (await request('/chats', 'GET', undefined, { Origin: 'https://evil.example' })).status,
      403,
    );
    assert.equal(
      (await request('/chats', 'POST', { cwd: '/not-a-real-directory-12345' })).status,
      400,
    );
    const created = await request('/chats', 'POST', { cwd: tmpdir() });
    assert.equal(created.status, 201);
    const chat = await created.json();
    assert.equal((await request(`/chats/${chat.id}/messages`, 'POST', { text: '' })).status, 400);
    const snapshot = await (await request(`/chats/${chat.id}`)).json();
    assert.deepEqual(snapshot.messages, []);
    assert.equal(snapshot.busy, false);
    const stream = await fetch(`${base}/chats/${chat.id}/events`);
    const reader = stream.body!.getReader();
    const { value } = await reader.read();
    assert.match(new TextDecoder().decode(value), /data:.*New chat/);
    await reader.cancel();
    await request(`/chats/${chat.id}`, 'PATCH', { title: 'Renamed chat' });
    assert.equal((await (await request('/chats')).json())[0].title, 'Renamed chat');
    assert.equal((await request(`/chats/${chat.id}`, 'PATCH', { archived: 'yes' })).status, 400);
    assert.equal(
      (await request(`/chats/${chat.id}`, 'PATCH', { archived: true, title: 'Ignored' })).status,
      400,
    );
    assert.equal((await request(`/chats/${chat.id}`, 'PATCH', { archived: true })).status, 200);
    assert.equal((await (await request('/chats')).json())[0].archived, true);
    assert.deepEqual((await (await request(`/chats/${chat.id}`)).json()).messages, []);
    assert.equal((await request(`/chats/${chat.id}`, 'PATCH', { archived: false })).status, 200);
    assert.equal((await (await request('/chats')).json())[0].archived, false);
    for (const values of [
      { pinned: 'yes' },
      { folder: 'x'.repeat(81) },
      { approvalMode: 1 },
      { pinned: true, approvalMode: false },
      { plan: [{ text: 'Step', status: ['pending'] }] },
      { plan: [{ text: ' ', status: 'pending' }] },
    ]) {
      assert.equal((await request(`/chats/${chat.id}`, 'PATCH', values)).status, 400);
    }
    for (const values of [
      { pinned: true },
      { folder: ' Project A ' },
      { approvalMode: true },
      { plan: [{ text: 'Run tests', status: 'pending' }] },
    ]) {
      assert.equal((await request(`/chats/${chat.id}`, 'PATCH', values)).status, 200);
    }
    const organized = await (await request(`/chats/${chat.id}`)).json();
    assert.equal(organized.chat.pinned, true);
    assert.equal(organized.chat.folder, 'Project A');
    assert.equal(organized.chat.approvalMode, true);
    assert.deepEqual(organized.chat.plan, [{ text: 'Run tests', status: 'pending' }]);
    assert.equal(
      (await request(`/chats/${chat.id}/approvals/nonexistent`, 'POST', { approved: true })).status,
      404,
    );
    assert.equal(
      (await request(`/chats/${chat.id}/approvals/nonexistent`, 'POST', { approved: 'yes' }))
        .status,
      400,
    );
    assert.equal((await request(`/chats/${chat.id}`, 'DELETE', {})).status, 200);
    assert.equal((await request(`/chats/${chat.id}`)).status, 404);
    assert.deepEqual(await (await request('/chats')).json(), []);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await Promise.race([
      exited,
      new Promise<void>((r) =>
        setTimeout(() => {
          child.kill('SIGKILL');
          r();
        }, 5000).unref(),
      ),
    ]);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
