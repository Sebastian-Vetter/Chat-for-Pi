import { test, expect } from '@playwright/test';

test('web commands are discoverable, keyboard accessible, and research progress is visible', async ({ page, request }) => {
  const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
  try {
    const snapshot = await (await request.get(`/api/chats/${chat.id}`)).json();
    snapshot.chat.subagentsEnabled = true;
    snapshot.events = [{ id: 'child', type: 'agent', label: 'Subagent · Research', status: 'running', timestamp: new Date().toISOString(), detail: 'Inspecting entry points with read' }];
    await page.addInitScript(id => localStorage.setItem('pi-chat-active', id), chat.id);
    await page.route(`**/api/chats/${chat.id}/events`, route => route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(snapshot)}\n\n` }));
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Research subagents' })).toContainText('Inspecting entry points with read');
    await page.getByRole('button', { name: 'Commands /', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Web commands' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Terminal-only commands');
    await dialog.getByRole('button', { name: '/subagent', exact: false }).click();
    await expect(page.getByRole('textbox', { name: 'Message Pi' })).toHaveValue('/subagent');
    await page.getByRole('textbox', { name: 'Message Pi' }).fill('/help');
    await page.getByRole('textbox', { name: 'Message Pi' }).press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  } finally { await request.delete(`/api/chats/${chat.id}`, { data: {} }); }
});
