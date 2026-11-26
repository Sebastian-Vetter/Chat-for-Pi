import { test, expect } from '@playwright/test';

interface WorkWindow extends Window {
  workSource?: EventSource;
}

for (const width of [1280, 390]) {
  test(`plan and queue share quiet on-demand details without shrinking the chat at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
    try {
      await request.patch(`/api/chats/${chat.id}/queue`, { data: { paused: true } });
      for (const text of ['First queued prompt', 'Second queued prompt'])
        await request.post(`/api/chats/${chat.id}/messages`, { data: { text, enqueue: true } });
      await request.patch(`/api/chats/${chat.id}`, {
        data: {
          plan: Array.from({ length: 20 }, (_, i) => ({
            text: `Visible task ${i + 1} with enough detail to require scrolling in the plan`,
            status: i === 0 ? 'done' : i === 1 ? 'running' : 'pending',
          })),
        },
      });
      const snapshot = await (await request.get(`/api/chats/${chat.id}`)).json();
      snapshot.messages = Array.from({ length: 50 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user',
        text: `Conversation message ${i + 1}.\n\nMore transcript content for scrolling.`,
      }));
      await page.addInitScript((id) => {
        localStorage.setItem('pi-chat-active', id);
        localStorage.setItem('pi-chat-settings', JSON.stringify({ showTaskPlan: true }));
        localStorage.setItem('pi-chat-queue-collapsed', 'false');
        const Native = window.EventSource;
        window.EventSource = class extends Native {
          constructor(url: string | URL, options?: EventSourceInit) {
            super(url, options);
            if (String(url).startsWith('/api/chats/')) (window as WorkWindow).workSource = this;
          }
        };
      }, chat.id);
      const initialEvents = `data: ${JSON.stringify(snapshot)}\n\n`;
      await page.route(`**/api/chats/${chat.id}/events`, (route) =>
        route.fulfill({ contentType: 'text/event-stream', body: initialEvents }),
      );
      await page.goto('/');
      const dock = page.locator('.work-dock');
      const panel = page.getByRole('region', {
        name: 'Work details',
        exact: true,
        includeHidden: true,
      });
      const planButton = page.getByRole('button', { name: 'Show task plan', exact: true });
      const queueButton = page.getByRole('button', { name: 'Show prompt queue', exact: true });
      await expect(planButton).toContainText('1/20');
      await expect(queueButton).toContainText('2 queued');
      await expect(queueButton).toContainText('Paused');
      await expect(panel).toBeHidden();
      const chatBox = await page.locator('.conversation-scroll').boundingBox();
      expect((await dock.boundingBox())!.height).toBeLessThanOrEqual(56);
      await planButton.click();
      await expect(page.getByRole('region', { name: 'Task plan', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Prompt queue', exact: true })).toHaveCount(0);
      await expect.poll(() => panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(844 * 0.55 + 2);
      const input = page.getByRole('textbox', { name: 'New plan step', exact: true });
      await input.fill('Preserve this unsent task');
      await queueButton.click();
      const queue = page.getByRole('region', { name: 'Prompt queue', exact: true });
      await expect(queue).toBeVisible();
      await expect(page.getByRole('region', { name: 'Task plan', exact: true })).toHaveCount(0);
      await expect(queue.getByText('First queued prompt', { exact: true })).toBeVisible();
      await expect(queue.getByRole('button', { name: 'Resume queue', exact: true })).toBeVisible();
      expect(await page.locator('.conversation-scroll').boundingBox()).toEqual(chatBox);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(queueButton).toBeFocused();
      await planButton.click();
      await expect(input).toHaveValue('Preserve this unsent task');
      await page.getByRole('textbox', { name: 'Message Pi', exact: true }).click();
      await expect(panel).toBeHidden();
      await expect(page.getByRole('textbox', { name: 'Message Pi', exact: true })).toBeFocused();

      // Live work only changes the counts, never steals space or opens details.
      snapshot.chat.plan.push({ text: 'New live task', status: 'pending' });
      snapshot.chat.planRevision++;
      snapshot.queue.push({
        ...snapshot.queue[0],
        id: 'extra-visible-fixture',
        text: 'New queued item',
      });
      await page.evaluate(
        (next) =>
          (window as WorkWindow).workSource!.dispatchEvent(
            new MessageEvent('message', { data: JSON.stringify(next) }),
          ),
        snapshot,
      );
      await expect(planButton).toContainText('1/21');
      await expect(queueButton).toContainText('3 queued');
      await expect(panel).toBeHidden();
      expect(await page.locator('.conversation-scroll').boundingBox()).toEqual(chatBox);
      await planButton.click();
      await page.keyboard.press('Control+k');
      await expect(
        page.getByRole('dialog', { name: 'Command palette', exact: true }),
      ).toBeVisible();
      await expect(panel).toBeHidden();
      await page.keyboard.press('Escape');
      await planButton.click();
      if (width === 390) {
        await page.setViewportSize({ width, height: 640 });
        expect((await panel.boundingBox())!.height).toBeLessThanOrEqual(640 * 0.55 + 2);
      }
      await page.getByRole('button', { name: 'Close work details', exact: true }).click();
      await expect(planButton).toBeFocused();
      await page.reload();
      await expect(panel).toBeHidden();
      await expect(queueButton).toContainText('2 queued');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const state = await (await request.get(`/api/chats/${chat.id}`)).json();
      expect(state.queue).toHaveLength(2);
      expect(state.queuePaused).toBe(true);
    } finally {
      await request.delete(`/api/chats/${chat.id}`, { data: {} });
    }
  });
}
