import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`sessions archive, restore and hide persist at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 });
    const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
    const title = `Archive fixture ${width}`;
    await request.patch(`/api/chats/${chat.id}`, { data: { title } });
    async function openSidebar() {
      const button = page.getByRole('button', { name: 'Open sidebar', exact: true });
      if (await button.isVisible()) await button.click();
    }
    try {
      await page.goto('/'); await openSidebar();
      await expect(page.getByText('YOUR CONVERSATIONS', { exact: true })).toHaveCount(0);
      const item = page.locator('.chat-item').filter({ hasText: title });
      await item.hover();
      await item.getByRole('button', { name: `Archive ${title}`, exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Conversations', exact: true }).getByText(title)).toHaveCount(0);
      await page.getByRole('button', { name: 'Open session archive', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Archived sessions', exact: true }).getByText(title)).toBeVisible();
      await page.reload(); await openSidebar();
      await page.getByRole('button', { name: 'Open session archive', exact: true }).click();
      await item.hover();
      await item.getByRole('button', { name: `Restore ${title}`, exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Archived sessions', exact: true }).getByText(title)).toHaveCount(0);
      await page.getByRole('button', { name: 'Show active sessions', exact: true }).click();
      await expect(item).toBeVisible();
      await page.getByRole('button', { name: 'Hide session list', exact: true }).click();
      await expect(item).toHaveCount(0);
      await page.reload(); await openSidebar();
      await expect(page.getByRole('button', { name: 'Show session list', exact: true })).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByRole('navigation', { name: 'Conversations', exact: true }).getByText(title)).toHaveCount(0);
      await page.getByRole('button', { name: 'Show session list', exact: true }).click();
      await expect(item).toBeVisible();
    } finally { await request.delete(`/api/chats/${chat.id}`, { data: {} }); }
  });
}
