import { test, expect } from '@playwright/test';

test('desktop: welcome, starter, workspace dialog, and saved chat management', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /What will we build/ })).toBeVisible();
  await page.getByRole('button', { name: /Explore a codebase/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message Pi' })).toHaveValue(
    /Explore this workspace/,
  );
  await page
    .getByRole('button', { name: /coding/, exact: false })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Working directory')).toBeEditable();
  await page.getByRole('button', { name: 'Use workspace' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const response = await request.post('/api/chats', { data: { cwd: process.cwd() } });
  const chat = await response.json();
  try {
    await request.patch(`/api/chats/${chat.id}`, { data: { title: 'Browser test conversation' } });
    await page.reload();
    await page.getByRole('button', { name: 'Browser test conversation', exact: true }).click();
    await expect(page.locator('.page-title')).toHaveText('Browser test conversation');
    await page.reload();
    await expect(page.locator('.page-title')).toHaveText('Browser test conversation');
    await page.getByLabel('Search chats').fill('no-matching-chat-1234');
    await expect(page.getByText('No matching conversations.')).toBeVisible();
    await page.getByLabel('Search chats').fill('');
    await page.screenshot({ path: '/tmp/pi-chat-desktop.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
  }
});

test('live Pi: send a message and reopen its persisted session', async ({ page, request }) => {
  test.skip(
    process.env.PI_CHAT_LIVE !== '1',
    'Opt-in: uses your configured Pi provider and may incur API costs.',
  );
  test.setTimeout(90000);
  const response = await request.post('/api/chats', { data: { cwd: process.cwd() } });
  const chat = await response.json();
  try {
    await page.addInitScript((id) => localStorage.setItem('pi-chat-active', id), chat.id);
    await page.goto('/');
    await page
      .getByRole('textbox', { name: 'Message Pi' })
      .fill('Reply with exactly: Pi Chat is connected. Do not use tools.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.assistant-message .message-body')).toHaveText(
      'Pi Chat is connected.',
      { timeout: 60000 },
    );
    await expect(page.getByRole('button', { name: 'Stop response' })).not.toBeVisible();
    await page.reload();
    await expect(page.locator('.assistant-message .message-body')).toHaveText(
      'Pi Chat is connected.',
    );
  } finally {
    await request.post(`/api/chats/${chat.id}/stop`, { data: {} });
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
  }
});

test('mobile: sidebar, composer, and layout fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /What will we build/ })).toBeVisible();
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.getByLabel('Conversations', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close sidebar', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: 'Message Pi' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '/tmp/pi-chat-mobile.png', fullPage: true });
});
