import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function openSidebar(page: Page) {
  const open = page.getByRole('button', { name: 'Open sidebar', exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.locator('aside.sidebar')).toBeVisible();
}
for (const width of [1280, 390]) {
  test(`local chat, sidebar, Chats/Shared and settings survive reload at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
    const title = `Remembered ${width} ${chat.id}`;
    let policy = { queuesEnabled: true, revision: 10000 };
    await page.route('**/api/settings', (route) => {
      if (route.request().method() === 'PATCH')
        policy = { ...route.request().postDataJSON(), revision: policy.revision + 1 };
      return route.fulfill({ json: policy });
    });
    try {
      await request.patch(`/api/chats/${chat.id}`, { data: { title } });
      await page.goto('/');
      await openSidebar(page);
      await page.locator('.chat-select').filter({ hasText: title }).click();
      await expect(page.locator('.page-title')).toHaveText(title);
      await openSidebar(page);
      await page.getByRole('tab', { name: 'Shared', exact: true }).click();
      await page
        .locator('aside.sidebar')
        .getByRole('button', { name: 'Close sidebar', exact: true })
        .click();
      await page.keyboard.press('Control+,');
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      await settings.getByRole('checkbox', { name: 'Enable finish sound', exact: true }).uncheck();
      await settings.getByRole('checkbox', { name: 'Show task plan bar', exact: true }).check();
      await settings.locator('#sound-preset').selectOption('soft');
      await settings.locator('#sound-volume').focus();
      await settings.locator('#sound-volume').press('End');
      await settings.getByRole('checkbox', { name: 'Enable prompt queues', exact: true }).click();
      await expect(
        settings.getByRole('checkbox', { name: 'Enable prompt queues', exact: true }),
      ).not.toBeChecked();
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      await page.reload();
      await expect(page.locator('.page-title')).toHaveText(title);
      await expect(page.locator('aside.sidebar')).toHaveCount(0);
      await page.keyboard.press('Control+,');
      await expect(
        settings.getByRole('checkbox', { name: 'Enable finish sound', exact: true }),
      ).not.toBeChecked();
      await expect(
        settings.getByRole('checkbox', { name: 'Show task plan bar', exact: true }),
      ).toBeChecked();
      await expect(
        settings.getByRole('checkbox', { name: 'Enable prompt queues', exact: true }),
      ).not.toBeChecked();
      await expect(settings.locator('#sound-preset')).toHaveValue('soft');
      await expect(settings.locator('#sound-volume')).toHaveValue('1');
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      await openSidebar(page);
      await expect(page.getByRole('tab', { name: 'Shared', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.reload();
      await expect(page.locator('aside.sidebar')).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Shared', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: 'Chats', exact: true }).click();
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Chats', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.locator('.page-title')).toHaveText(title);
    } finally {
      await request.delete(`/api/chats/${chat.id}`, { data: {} });
    }
  });

  test(`joined session restores after loading and removed selections fall back safely at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let joined = true,
      delayListing = false,
      releaseListing: (() => void) | undefined;
    let calls = 0;
    await page.route('**/api/shared/sessions', async (route) => {
      if (delayListing)
        await new Promise<void>((resolve) => {
          releaseListing = resolve;
        });
      return route.fulfill({
        json: {
          owner: { id: 'local', name: 'Browser fixture', publicKey: 'fixture' },
          owned: [],
          joined: joined
            ? [{ id: 'joined-remembered', ownerId: 'owner', title: 'Remembered shared project' }]
            : [],
        },
      });
    });
    await page.route('**/api/shared/joined/joined-remembered/rpc', (route) => {
      calls++;
      return route.fulfill({
        json: {
          id: 'project',
          title: 'Remembered shared project',
          role: 'reader',
          owner: { id: 'owner', name: 'Alice' },
          messages: [{ role: 'assistant', text: 'Remembered shared transcript' }],
          queue: [],
          busy: false,
          queuePaused: false,
          queuesEnabled: true,
        },
      });
    });
    await page.goto('/');
    await openSidebar(page);
    await page.getByRole('tab', { name: 'Shared', exact: true }).click();
    await page
      .locator('.shared-session-row')
      .getByRole('button', { name: /^Remembered shared project/ })
      .click();
    await expect(page.getByText('Remembered shared transcript', { exact: true })).toBeVisible();
    await openSidebar(page);
    await page
      .locator('aside.sidebar')
      .getByRole('button', { name: 'Close sidebar', exact: true })
      .click();
    delayListing = true;
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Restoring shared session…');
    const before = calls;
    await expect.poll(() => !!releaseListing).toBe(true);
    expect(calls).toBe(before);
    delayListing = false;
    releaseListing!();
    await expect(page.getByText('Remembered shared transcript', { exact: true })).toBeVisible();
    await expect(page.locator('aside.sidebar')).toHaveCount(0);
    await openSidebar(page);
    await expect(page.getByRole('tab', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.shared-session-row .selected')).toContainText(
      'Remembered shared project',
    );
    joined = false;
    const beforeMissing = calls;
    await page.reload();
    await expect(page.locator('.page-title')).toHaveText('New conversation');
    await expect(page.locator('aside.sidebar')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(calls).toBe(beforeMissing);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('pi-chat-navigation')!).remote),
    ).toBeNull();
  });
}

test('navigating away during a delayed shared restore does not reopen the old session', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  let calls = 0;
  await page.addInitScript(() =>
    localStorage.setItem(
      'pi-chat-navigation',
      JSON.stringify({ version: 1, sidebarOpen: false, tab: 'shared', remote: 'joined-late' }),
    ),
  );
  await page.route('**/api/shared/sessions', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      json: {
        owner: { id: 'local', name: 'Browser fixture', publicKey: 'fixture' },
        owned: [],
        joined: [{ id: 'joined-late', ownerId: 'owner', title: 'Late shared project' }],
      },
    });
  });
  await page.route('**/api/shared/joined/joined-late/rpc', (route) => {
    calls++;
    return route.fulfill({ json: {} });
  });
  await page.goto('/');
  await expect(page.getByRole('status')).toHaveText('Restoring shared session…');
  await expect.poll(() => !!release).toBe(true);
  await openSidebar(page);
  await page.getByRole('tab', { name: 'Chats', exact: true }).click();
  await expect(page.locator('.page-title')).toHaveText('New conversation');
  const response = page.waitForResponse('**/api/shared/sessions');
  release!();
  await response;
  await expect(page.locator('.page-title')).toHaveText('New conversation');
  await expect(page.getByRole('tab', { name: 'Chats', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(calls).toBe(0);
});

test('deleted local chats are not retained as the active selection', async ({ page, request }) => {
  const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
  const title = `Deleted selection ${chat.id}`;
  await request.patch(`/api/chats/${chat.id}`, { data: { title } });
  await page.goto('/');
  await openSidebar(page);
  await page.locator('.chat-select').filter({ hasText: title }).click();
  await expect(page.locator('.page-title')).toHaveText(title);
  await request.delete(`/api/chats/${chat.id}`, { data: {} });
  await page.reload();
  await expect(page.locator('.page-title')).toHaveText('New conversation');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pi-chat-active'))).toBeNull();
});

test('legacy owned shared selections migrate to Shared, while an explicit Chats tab stays independent', async ({
  page,
  request,
}) => {
  const root = await mkdtemp(join(tmpdir(), 'chat-navigation-owned-'));
  const response = await request.post('/api/shared/sessions', {
    data: { folder: join(root, 'project'), title: 'Remembered owner project', trustWriters: true },
  });
  expect(response.ok()).toBe(true);
  const chat = await response.json();
  try {
    await page.addInitScript((id) => {
      if (!sessionStorage.getItem('navigation-seeded')) {
        localStorage.setItem('pi-chat-active', id);
        sessionStorage.setItem('navigation-seeded', 'yes');
      }
    }, chat.id);
    await page.goto('/');
    await expect(page.locator('.page-title')).toHaveText('Remembered owner project');
    await expect(page.getByRole('tab', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('.shared-session-topbar')).toContainText('Shared · Owner');
    await page.getByRole('tab', { name: 'Chats', exact: true }).click();
    await page.reload();
    await expect(page.locator('.page-title')).toHaveText('Remembered owner project');
    await expect(page.getByRole('tab', { name: 'Chats', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  } finally {
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
    await rm(root, { recursive: true, force: true });
  }
});
