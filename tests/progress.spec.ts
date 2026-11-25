import { test, expect } from '@playwright/test';

for (const reduced of [false, true]) {
  test(`thinking stays in the transcript and composer progress ${reduced ? 'respects Reduce Motion' : 'flows left to right'}`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const response = await request.post('/api/chats', { data: { cwd: process.cwd() } });
    const chat = await response.json();
    let busy = true;
    await page.addInitScript((id) => localStorage.setItem('pi-chat-active', id), chat.id);
    await page.route(`**/api/chats/${chat.id}/events`, (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ chat, busy, messages: [], events: busy ? [{ id: 'progress-test', type: 'agent', label: 'Pi coding run', status: 'running', timestamp: new Date().toISOString() }] : [] })}\n\n`,
      }),
    );
    try {
      await page.goto('/');
      await expect(page.locator('.transcript .thinking-panel')).toBeVisible();
      await expect(page.locator('.composer-area .thinking-panel')).toHaveCount(0);
      await expect(page.locator('.transcript .status-line')).toHaveCount(0);
      const composer = page.getByRole('form', { name: 'Message composer' });
      await expect(composer).toHaveAttribute('aria-busy', 'true');
      await expect(composer).toHaveClass(/composer-working/);
      const animation = await composer.evaluate(
        (el) => getComputedStyle(el, '::after').animationName,
      );
      expect(animation).toBe(reduced ? 'none' : 'composer-flow');
      if (reduced) {
        expect(await composer.evaluate((el) => getComputedStyle(el, '::after').transform)).toBe(
          'none',
        );
      } else {
        const transform = (progress: number) =>
          composer.evaluate((el, value) => {
            const animation = el
              .getAnimations({ subtree: true })
              .find((item) => (item as CSSAnimation).animationName === 'composer-flow');
            animation?.pause();
            if (animation) animation.currentTime = value * 1800;
            return getComputedStyle(el, '::after').transform;
          }, progress);
        const start = await transform(0.1),
          end = await transform(0.8);
        const x = (matrix: string) => Number(matrix.split(',')[4]);
        expect(x(end)).toBeGreaterThan(x(start));
      }
      busy = false;
      await page.reload();
      await expect(composer).toHaveAttribute('aria-busy', 'false');
      await expect(composer).not.toHaveClass(/composer-working/);
      await expect(page.locator('.thinking-panel')).toHaveCount(0);
    } finally {
      await request.delete(`/api/chats/${chat.id}`, { data: {} });
    }
  });
}
