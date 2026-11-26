import { test, expect, type Page, type APIResponse } from '@playwright/test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Snapshot } from '../src/api';

const version: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

type TestWindow = Window & { conversationSource?: EventSource };

test('approval proposals gate real configured-test execution and reject unsafe mode changes while waiting', async ({
  page,
  request,
}) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-chat-ui-approval-'));
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({
      scripts: { test: `node -e "require('fs').writeFileSync('executed.txt','approved')"` },
    }),
  );
  const chat = await (await request.post('/api/chats', { data: { cwd } })).json();
  let launched: Promise<APIResponse> | undefined;
  try {
    await request.patch(`/api/chats/${chat.id}`, { data: { approvalMode: true } });
    await openConversation(page, chat.id);
    launched = request.post(`/api/chats/${chat.id}/tests`, { data: { taskId: 'package:test' } });
    const approval = page.getByRole('region', {
      name: 'Approval for configured_test',
      exact: true,
    });
    await expect(approval).toBeVisible();
    await expect(approval).toContainText('npm run test');
    expect(existsSync(join(cwd, 'executed.txt'))).toBe(false);
    expect(
      (await request.patch(`/api/chats/${chat.id}`, { data: { approvalMode: false } })).status(),
    ).toBe(409);
    await approval.getByRole('button', { name: 'Reject', exact: true }).click();
    expect((await launched).status()).toBe(409);
    expect(existsSync(join(cwd, 'executed.txt'))).toBe(false);
    await expect(approval).toHaveCount(0);
    launched = request.post(`/api/chats/${chat.id}/tests`, { data: { taskId: 'package:test' } });
    await expect(approval).toBeVisible();
    await approval.getByRole('button', { name: 'Approve once', exact: true }).click();
    expect((await launched).status()).toBe(202);
    await expect.poll(() => existsSync(join(cwd, 'executed.txt'))).toBe(true);
    expect(await readFile(join(cwd, 'executed.txt'), 'utf8')).toBe('approved');
    await expect
      .poll(async () => (await (await request.get(`/api/chats/${chat.id}/tests`)).json()).running)
      .toBe(false);
  } finally {
    await request.post(`/api/chats/${chat.id}/tests/stop`, { data: {} });
    await launched?.catch(() => {});
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
    await rm(cwd, { recursive: true, force: true });
  }
});

async function openConversation(page: Page, id: string) {
  await page.addInitScript((chatId) => {
    localStorage.setItem('pi-chat-active', chatId);
    localStorage.setItem('pi-chat-settings', JSON.stringify({ showTaskPlan: true }));
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        if (String(url).startsWith('/api/chats/'))
          (window as unknown as TestWindow).conversationSource = this;
      }
    };
  }, id);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Show task plan', exact: true })).toBeVisible();
}

for (const width of [1280, 390]) {
  test(`pinning, folders and task plans persist in a quiet interface at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
    await request.patch(`/api/chats/${chat.id}`, { data: { title: `Workflow ${chat.id}` } });
    try {
      await page.addInitScript(() =>
        localStorage.setItem(
          'pi-chat-prompt-templates',
          JSON.stringify([{ name: 'Old review', shortcut: '/my-review', text: 'Old expansion' }]),
        ),
      );
      await openConversation(page, chat.id);
      if (width < 760)
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      const row = page
        .locator('.chat-item')
        .filter({ has: page.getByRole('button', { name: `Workflow ${chat.id}`, exact: true }) });
      await row.hover();
      await row.getByRole('button', { name: `Pin Workflow ${chat.id}`, exact: true }).click();
      await expect(
        row.getByRole('button', { name: `Unpin Workflow ${chat.id}`, exact: true }),
      ).toHaveCount(1);
      page.once('dialog', (dialog) => dialog.accept('My project folder'));
      await row
        .getByRole('button', { name: `Move Workflow ${chat.id} to folder`, exact: true })
        .click();
      await page
        .getByRole('combobox', { name: 'Group sessions', exact: true })
        .selectOption('folder');
      // Unpin to see the custom folder group, then restore the favorite.
      await row.getByRole('button', { name: `Unpin Workflow ${chat.id}`, exact: true }).click();
      await expect(
        page.locator('.session-group-heading').filter({ hasText: 'Folder · My project folder' }),
      ).toBeVisible();
      if (width < 760)
        await page
          .locator('.sidebar')
          .getByRole('button', { name: 'Close sidebar', exact: true })
          .click();

      await page.getByRole('button', { name: 'Show task plan', exact: true }).click();
      await page
        .getByRole('textbox', { name: 'New plan step', exact: true })
        .fill('Verify the workflow');
      await page.getByRole('button', { name: 'Add step', exact: true }).click();
      await expect(page.locator('.task-plan')).toContainText('Verify the workflow');
      await page
        .getByRole('button', { name: 'Change status of Verify the workflow', exact: true })
        .click();
      await expect(page.locator('.plan-status')).toHaveText('◉ Running');
      await page
        .getByRole('button', { name: 'Change status of Verify the workflow', exact: true })
        .click();
      await expect(page.locator('.plan-status')).toHaveText('✓ Done');

      await expect(page.getByRole('checkbox', { name: 'Require action approvals' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Templates', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Usage limits', exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Export chat', exact: true })).toHaveText('');

      // No inference: removed template shortcuts must be submitted verbatim.
      await page.route(`**/api/chats/${chat.id}/messages`, (route) =>
        route.fulfill({ status: 202, json: { ok: true } }),
      );
      await page
        .getByRole('textbox', { name: 'Message Pi', exact: true })
        .fill('/my-review src/App.tsx');
      const sent = page.waitForRequest((req) =>
        req.url().endsWith(`/api/chats/${chat.id}/messages`),
      );
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      expect((await sent).postDataJSON().text).toBe('/my-review src/App.tsx');
      await page.reload();
      await expect(page.locator('.task-plan')).toContainText('1/1 done');
      const persisted = await (await request.get(`/api/chats/${chat.id}`)).json();
      expect(persisted.chat.folder).toBe('My project folder');
      expect(persisted.chat.plan[0].status).toBe('done');
    } finally {
      await request.delete(`/api/chats/${chat.id}`, { data: {} });
    }
  });
}

test('command palette finds chats, projects, models and actions with keyboard navigation', async ({
  page,
  request,
}) => {
  const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
  const title = `Palette target ${chat.id}`;
  await request.patch(`/api/chats/${chat.id}`, { data: { title } });
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        version,
        defaultCwd: process.cwd(),
        models: [{ key: 'fixture/model', name: 'Fixture model', provider: 'fixture' }],
      },
    }),
  );
  try {
    await openConversation(page, chat.id);
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true });
    const search = dialog.getByRole('combobox');
    await search.fill('Fixture model');
    await expect(dialog.getByRole('option')).toHaveCount(1);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue(
      'fixture/model',
    );

    await page.keyboard.press('Control+k');
    await search.fill(title);
    await search.press('Enter');
    await expect(page.locator('.page-title')).toHaveText(title);
    await page.keyboard.press('Control+k');
    await search.fill('Project');
    await expect(dialog.getByRole('option').first()).toContainText('Project');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await page.keyboard.press('Control+k');
    await search.fill('Usage limits');
    await expect(dialog.getByRole('option')).toHaveCount(0);
    await search.fill('Prompt templates');
    await expect(dialog.getByRole('option')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+n');
    await expect(page.locator('.welcome')).toBeVisible();
  } finally {
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
  }
});

test('Markdown downloads support the complete chat or selected visible answers', async ({
  page,
  request,
}) => {
  const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
  try {
    await openConversation(page, chat.id);
    const snapshot = (await (await request.get(`/api/chats/${chat.id}`)).json()) as Snapshot;
    snapshot.messages = [
      { role: 'user', text: 'Original question' },
      { role: 'assistant', text: 'First visible answer' },
      { role: 'toolResult', toolName: 'bash', text: '```\nTool output\n```' },
      { role: 'assistant', text: 'Selected second answer' },
    ];
    await page.evaluate(
      (next) =>
        (window as unknown as TestWindow).conversationSource!.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify(next) }),
        ),
      snapshot,
    );
    await expect(page.getByRole('checkbox', { name: 'Select response for export' })).toHaveCount(2);
    const fullDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export chat', exact: true }).click();
    const full = await fullDownload;
    expect(full.suggestedFilename()).toMatch(/\.md$/);
    expect(await readFile((await full.path())!, 'utf8')).toContain('Original question');
    await page.getByRole('checkbox', { name: 'Select response for export' }).nth(1).check();
    const selectedExport = page.getByRole('button', { name: 'Export selected (1)', exact: true });
    await expect(selectedExport).toHaveText('');
    await expect(selectedExport).toHaveAttribute(
      'title',
      'Export 1 selected responses as Markdown',
    );
    const partialDownload = page.waitForEvent('download');
    await selectedExport.press('Enter');
    const partial = await readFile((await (await partialDownload).path())!, 'utf8');
    expect(partial).toContain('Selected second answer');
    expect(partial).not.toContain('First visible answer');
    expect(partial).not.toContain('Original question');
  } finally {
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
  }
});
