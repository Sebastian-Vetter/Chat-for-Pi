import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`queue stays at the top and remembers its hidden state at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
    try {
      await request.patch(`/api/chats/${chat.id}/queue`, { data: { paused: true } });
      for (const text of ['First queued prompt', 'Second queued prompt']) {
        await request.post(`/api/chats/${chat.id}/messages`, { data: { text, enqueue: true } });
      }
      const snapshot = await (await request.get(`/api/chats/${chat.id}`)).json();
      snapshot.messages = Array.from({ length: 50 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        text: `Conversation message ${i + 1}.\n\nMore transcript content for scrolling.`,
      }));
      await page.addInitScript((id) => localStorage.setItem('pi-chat-active', id), chat.id);
      await page.route(`**/api/chats/${chat.id}/events`, (route) =>
        route.fulfill({
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify(snapshot)}\n\n`,
        }),
      );
      await page.goto('/');
      const queue = page.getByRole('region', { name: 'Prompt queue', exact: true });
      await expect(queue).toBeVisible();
      await expect(queue.getByText('2 queued', { exact: true })).toBeVisible();
      await expect(page.locator('.composer-area .prompt-queue')).toHaveCount(0);
      const header = await page.locator('.topbar').boundingBox();
      const initial = await queue.boundingBox();
      expect(initial!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
      await page.locator('.conversation-scroll').evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect.poll(async () => (await queue.boundingBox())!.y).toBeCloseTo(initial!.y, 0);
      await page.locator('.conversation-scroll').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect.poll(async () => (await queue.boundingBox())!.y).toBeCloseTo(initial!.y, 0);
      await page.getByRole('button', { name: 'Hide prompt queue', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Show prompt queue', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByText('First queued prompt', { exact: true })).not.toBeVisible();
      await expect(queue.getByText('2 queued', { exact: true })).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole('button', { name: 'Show prompt queue', exact: true }),
      ).toHaveAttribute('aria-expanded', 'false');
      await page.getByRole('button', { name: 'Show prompt queue', exact: true }).click();
      await expect(page.getByText('First queued prompt', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Resume queue', exact: true })).toBeVisible();
      const state = await (await request.get(`/api/chats/${chat.id}`)).json();
      expect(state.queue).toHaveLength(2);
      expect(state.queuePaused).toBe(true);
    } finally {
      await request.delete(`/api/chats/${chat.id}`, { data: {} });
    }
  });
}
