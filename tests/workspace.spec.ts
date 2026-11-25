import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

test('workspace: instructions, clickable diff, local tests, activity and paused prompt queue', async ({ page, request }) => {
  const directory = mkdtempSync(join(tmpdir(), 'chat-browser-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { stdio: 'pipe' });
  git('init'); git('config', 'user.name', 'Browser test'); git('config', 'user.email', 'test@example.invalid');
  writeFileSync(join(directory, 'AGENTS.md'), '# Workspace rules\n\nKeep tests passing.\n');
  writeFileSync(join(directory, 'note.txt'), 'before\n');
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(12345)"' } }));
  git('add', '.'); git('commit', '-m', 'fixture'); writeFileSync(join(directory, 'note.txt'), 'after\n');
  const chat = await (await request.post('/api/chats', { data: { cwd: directory } })).json();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.addInitScript(id => localStorage.setItem('pi-chat-active', id), chat.id);
    await page.goto('/');
    await page.getByRole('button', { name: /AGENTS\.md Workspace/ }).click();
    await expect(page.getByRole('heading', { name: 'Workspace rules' })).toBeVisible();
    await page.getByRole('button', { name: 'View source' }).click();
    await expect(page.locator('.file-dialog-content pre')).toContainText('# Workspace rules');
    await page.getByRole('button', { name: 'Close instructions' }).click();
    await page.getByRole('button', { name: 'Toggle workspace tools' }).click();
    await page.getByTitle('note.txt', { exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Diff for note.txt' })).toBeVisible();
    await expect(page.locator('.diff-content')).toContainText('-before');
    await expect(page.locator('.diff-content')).toContainText('+after');
    await page.getByLabel('Full file context').check();
    await expect(page.locator('.diff-content')).toContainText('+after');
    await page.getByRole('button', { name: 'Close diff' }).click();
    await page.getByRole('tab', { name: 'Tests', exact: true }).click();
    await page.getByRole('button', { name: 'Run test', exact: true }).click();
    await expect(page.locator('.activity-event').first()).toContainText('passed', { timeout: 15000 });
    await page.locator('.activity-event').first().locator('summary').click();
    await expect(page.locator('.activity-event').first()).toContainText('12345');
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await expect(page.locator('.activity-event')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close workspace tools' }).click();
    await request.patch(`/api/chats/${chat.id}/queue`, { data: { paused: true } });
    await request.post(`/api/chats/${chat.id}/messages`, { data: { text: 'First queued task', enqueue: true } });
    await expect(page.getByText('1 queued', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Message Pi' }).fill('Second queued task');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText('2 queued', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove queued prompt First queued task' }).click();
    await expect(page.getByText('1 queued', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await request.post(`/api/chats/${chat.id}/tests/stop`, { data: {} });
    await request.delete(`/api/chats/${chat.id}`, { data: {} }); rmSync(directory, { recursive: true, force: true });
  }
});

test('settings: version, EV sound presets, Mac shortcuts and reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: `v${version}`, exact: true })).toBeVisible();
  expect(await page.locator('.welcome h1').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.keyboard.press('Meta+,');
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Mac shortcuts', { exact: true })).toBeVisible();
  await page.getByLabel('Enable finish sound').check();
  await page.getByLabel(/Sound preset/).selectOption('success');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByLabel('Enable finish sound')).toBeChecked();
  await expect(page.getByLabel(/Sound preset/)).toHaveValue('success');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+e');
  await expect(page.getByRole('complementary', { name: 'Workspace tools' })).toBeVisible();
});
