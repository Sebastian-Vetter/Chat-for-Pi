import { test, expect, type Locator, type Page } from '@playwright/test';
import type { Snapshot } from '../src/api';

type ScrollTestWindow = Window & { conversationEvents: Record<string, EventSource> };

function messages(count: number, prefix: string) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    text: `${prefix} ${index + 1}\n\n${'A paragraph of conversation content for scrolling. '.repeat(8)}`,
  }));
}

async function position(viewport: Locator) {
  return viewport.evaluate((element) => ({
    top: element.scrollTop,
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
  }));
}

async function expectBottom(viewport: Locator) {
  await expect.poll(async () => (await position(viewport)).gap).toBeLessThanOrEqual(2);
}

async function waitForScrollToStop(viewport: Locator) {
  let previousTop: number | undefined;
  // Native PageUp/wheel scrolling may continue after the input event has returned.
  await expect
    .poll(async () => {
      const { top } = await position(viewport);
      const stopped = top === previousTop;
      previousTop = top;
      return stopped;
    })
    .toBe(true);
}

async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function appendLateImage(page: Page) {
  await page
    .locator('.message-body')
    .last()
    .evaluate(async (element) => {
      const image = new Image();
      image.alt = 'Late-loading transcript image';
      image.src =
        'data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="800"></svg>',
        );
      element.append(image);
      await image.decode();
    });
}

async function publish(page: Page, snapshot: Snapshot) {
  await page.evaluate((next) => {
    const source = (window as unknown as ScrollTestWindow).conversationEvents[
      `/api/chats/${next.chat.id}/events`
    ];
    if (!source) throw new Error('Conversation event source is not connected');
    source.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(next) }));
  }, snapshot);
  await settleLayout(page);
}

async function instrumentEvents(page: Page, active: string) {
  await page.addInitScript((id) => {
    localStorage.setItem('pi-chat-active', id);
    const sources: Record<string, EventSource> = {};
    (window as unknown as ScrollTestWindow).conversationEvents = sources;
    const NativeEventSource = window.EventSource;
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        sources[new URL(url, window.location.href).pathname] = this;
      }
    };
  }, active);
}

for (const { width, reducedMotion } of [
  { width: 1280, reducedMotion: 'no-preference' as const },
  { width: 390, reducedMotion: 'reduce' as const },
]) {
  test(`conversation opens and follows the bottom without interrupting reading at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion });
    const chats = [];
    const snapshots = new Map<string, Snapshot>();
    for (const name of ['First', 'Second']) {
      const created = await (
        await request.post('/api/chats', { data: { cwd: process.cwd() } })
      ).json();
      const chat = await (
        await request.patch(`/api/chats/${created.id}`, {
          data: { title: `${name} scroll test ${created.id}` },
        })
      ).json();
      chats.push(chat);
      const snapshot = (await (await request.get(`/api/chats/${chat.id}`)).json()) as Snapshot;
      snapshot.messages = messages(30, name);
      snapshots.set(chat.id, snapshot);
      await page.route(`**/api/chats/${chat.id}/events`, (route) =>
        route.fulfill({
          contentType: 'text/event-stream',
          body: `data: ${JSON.stringify(snapshots.get(chat.id))}\n\n`,
        }),
      );
    }

    try {
      await instrumentEvents(page, chats[0].id);
      await page.goto('/');
      const viewport = page.getByRole('region', { name: 'Conversation', exact: true });
      await expect(page.locator('.message')).toHaveCount(30);
      await expectBottom(viewport);
      expect((await position(viewport)).top).toBeGreaterThan(500);

      // Images can increase transcript height after the initial snapshot/render.
      await appendLateImage(page);
      await expectBottom(viewport);

      const snapshot = snapshots.get(chats[0].id)!;
      snapshot.messages.push(...messages(3, 'Streaming while following'));
      await publish(page, snapshot);
      await expectBottom(viewport);

      await page.setViewportSize({ width, height: 700 });
      await expectBottom(viewport);

      const beforeReading = (await position(viewport)).top;
      if (width === 1280) {
        const bounds = await viewport.boundingBox();
        await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
        await page.mouse.wheel(0, -600);
      } else {
        await viewport.focus();
        await page.keyboard.press('PageUp');
      }
      await expect
        .poll(async () => (await position(viewport)).top)
        .toBeLessThan(beforeReading - 100);
      await waitForScrollToStop(viewport);
      const readingTop = (await position(viewport)).top;
      await expect(
        page.getByRole('button', { name: 'Jump to latest ↓', exact: true }),
      ).toBeVisible();

      snapshot.messages.push(...messages(5, 'Arriving while reading older messages'));
      await publish(page, snapshot);
      await expect(page.locator('.message')).toHaveCount(snapshot.messages.length);
      expect(Math.abs((await position(viewport)).top - readingTop)).toBeLessThanOrEqual(2);
      expect((await position(viewport)).gap).toBeGreaterThan(100);
      await appendLateImage(page);
      await page.setViewportSize({ width, height: 650 });
      await settleLayout(page);
      expect(Math.abs((await position(viewport)).top - readingTop)).toBeLessThanOrEqual(2);

      await expect(
        page.getByRole('button', { name: 'New reply · Jump to latest ↓', exact: true }),
      ).toBeVisible();
      // Both the jump button and scrollbar/End-style movement resume following.
      if (width === 1280)
        await page
          .getByRole('button', { name: 'New reply · Jump to latest ↓', exact: true })
          .click();
      else
        await viewport.evaluate((element) => {
          element.scrollTop = element.scrollHeight;
        });
      await expectBottom(viewport);
      await expect(page.getByRole('button', { name: /Jump to latest/ })).toHaveCount(0);
      await settleLayout(page);
      snapshot.messages.push(...messages(3, 'Following resumed'));
      await publish(page, snapshot);
      await expectBottom(viewport);

      // Reload and switching away from a paused conversation must both start below.
      await viewport.evaluate((element) => {
        element.scrollTop = 0;
      });
      await settleLayout(page);
      await page.reload();
      await expect(page.locator('.message')).toHaveCount(snapshot.messages.length);
      await expectBottom(viewport);
      await viewport.evaluate((element) => {
        element.scrollTop = 0;
      });
      await settleLayout(page);
      if (width < 760)
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      await page.getByRole('button', { name: chats[1].title, exact: true }).click();
      await expect(page.locator('.page-title')).toHaveText(chats[1].title);
      await expect(page.locator('.message')).toHaveCount(30);
      await expectBottom(viewport);
    } finally {
      for (const chat of chats) await request.delete(`/api/chats/${chat.id}`, { data: {} });
    }
  });
}

test('activity-only runs follow layout changes and touch intent pauses following', async ({
  page,
  request,
}) => {
  const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
  const snapshot = (await (await request.get(`/api/chats/${chat.id}`)).json()) as Snapshot;
  snapshot.busy = true;
  snapshot.events = Array.from({ length: 45 }, (_, index) => ({
    id: `tool-${index}`,
    type: 'tool',
    label: 'bash',
    status: 'running',
    timestamp: new Date().toISOString(),
    detail: JSON.stringify({ command: `Research step ${index}` }),
  }));
  for (let index = 0; index < 4; index++) {
    snapshot.events.push({
      id: `research-${index}`,
      type: 'agent',
      label: 'Subagent · Research',
      status: 'running',
      timestamp: new Date().toISOString(),
      detail: `Research task ${index}\n${'Observable research progress.\n'.repeat(20)}`,
    });
  }
  await page.route(`**/api/chats/${chat.id}/events`, (route) =>
    route.fulfill({
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify(snapshot)}\n\n`,
    }),
  );

  try {
    await instrumentEvents(page, chat.id);
    await page.goto('/');
    const viewport = page.getByRole('region', { name: 'Conversation', exact: true });
    await expect(page.locator('.thinking-step')).toHaveCount(45);
    await expectBottom(viewport);
    expect((await position(viewport)).top).toBeGreaterThan(100);

    await viewport.evaluate((element) => {
      const start = new Touch({ identifier: 1, target: element, clientY: 200 });
      const moved = new Touch({ identifier: 1, target: element, clientY: 260 });
      element.dispatchEvent(new TouchEvent('touchstart', { touches: [start] }));
      element.dispatchEvent(new TouchEvent('touchmove', { touches: [moved] }));
    });
    const before = (await position(viewport)).top;
    snapshot.messages = messages(10, 'Text arriving after touch intent');
    await publish(page, snapshot);
    await expect(page.locator('.message')).toHaveCount(10);
    expect(Math.abs((await position(viewport)).top - before)).toBeLessThanOrEqual(2);
    expect((await position(viewport)).gap).toBeGreaterThan(100);
  } finally {
    await request.delete(`/api/chats/${chat.id}`, { data: {} });
  }
});
