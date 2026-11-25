import { test, expect, type Page } from '@playwright/test';

async function mockSound(page: Page, disabled = false, blocked = false) {
  await page.addInitScript({
    content: `
    ${disabled ? "localStorage.setItem('pi-chat-settings', JSON.stringify({ finishSound: false }));" : ''}
    window.__soundNotes = 0;
    window.AudioContext = class {
      state = 'running'; currentTime = 0;
      async resume() { ${blocked ? "throw new Error('Audio blocked by browser');" : ''} }
      createOscillator() { return { frequency: { value: 0 }, connect() {}, disconnect() {}, start() { window.__soundNotes++; }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    };
    const NativeEventSource = window.EventSource;
    window.EventSource = function(url, options) {
      if (url !== '/api/events') return new NativeEventSource(url, options);
      const stream = { onmessage: null, close() {} };
      window.__emitChatStatus = data => stream.onmessage?.({ data: JSON.stringify(data) });
      return stream;
    };
  `,
  });
  await page.goto('/');
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __emitChatStatus?: unknown }).__emitChatStatus === 'function',
  );
  await page.locator('.new-chat').click();
}
async function status(page: Page, busy: boolean) {
  await page.evaluate((busy) => {
    const emit = (window as unknown as { __emitChatStatus: (event: unknown) => void })
      .__emitChatStatus;
    emit({ type: 'chat', chat: { id: 'sound-test', busy } });
  }, busy);
}
async function notes(page: Page) {
  return page.evaluate(() => (window as unknown as { __soundNotes: number }).__soundNotes);
}

test('finish sound is automatic by default, only after the response finishes, and does not repeat', async ({
  page,
}) => {
  await mockSound(page);
  await status(page, true);
  expect(await notes(page)).toBe(0);
  await status(page, false);
  await expect.poll(() => notes(page)).toBe(3);
  await status(page, false);
  expect(await notes(page)).toBe(3);
});
test('an explicitly disabled finish sound stays disabled', async ({ page }) => {
  await mockSound(page, true);
  await status(page, true);
  await status(page, false);
  expect(await notes(page)).toBe(0);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await expect(page.getByLabel('Enable finish sound')).not.toBeChecked();
});
test('blocked finish audio displays instructions instead of failing silently', async ({ page }) => {
  await mockSound(page, false, true);
  await status(page, true);
  await status(page, false);
  await expect(page.getByRole('button', { name: 'Audio settings', exact: true })).toBeVisible();
  await expect(page.getByText(/browser could not play the chime/)).toBeVisible();
});
