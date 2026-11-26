import { test, expect } from '@playwright/test';

interface Sources extends Window {
  chatSource?: EventSource;
  globalSource?: EventSource;
}

for (const width of [1280, 390]) {
  test(`queue policy and task-plan visibility are configurable with quiet defaults at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const chat = await (await request.post('/api/chats', { data: { cwd: process.cwd() } })).json();
    const base = `/api/chats/${chat.id}`;
    // Browser policies are mocked here so parallel tests never change the shared server policy.
    // Real backend enforcement, persistence and active-run behavior have dedicated API/unit tests.
    let policy = { queuesEnabled: true, revision: 0 };
    let failNextSave = false;
    const sent: { text: string; enqueue: boolean }[] = [];
    try {
      await request.patch(base, {
        data: { plan: [{ text: 'Keep this plan', status: 'pending' }] },
      });
      await request.patch(`${base}/queue`, { data: { paused: true } });
      await request.post(`${base}/messages`, { data: { text: 'Saved prompt', enqueue: true } });
      const snapshot = await (await request.get(base)).json();
      snapshot.busy = true;
      await page.addInitScript((id) => {
        localStorage.setItem('pi-chat-active', id);
        const Native = window.EventSource;
        window.EventSource = class extends Native {
          constructor(url: string | URL, options?: EventSourceInit) {
            super(url, options);
            if (String(url) === '/api/events') (window as Sources).globalSource = this;
            if (String(url).startsWith('/api/chats/')) (window as Sources).chatSource = this;
          }
        };
      }, chat.id);
      await page.route('**/api/settings', (route) => {
        if (route.request().method() === 'PATCH') {
          if (failNextSave) {
            failNextSave = false;
            return route.fulfill({ status: 503, json: { error: 'Settings could not be saved' } });
          }
          policy = { ...route.request().postDataJSON(), revision: policy.revision + 1 };
        }
        return route.fulfill({ json: policy });
      });
      await page.route(`**${base}/messages`, (route) => {
        sent.push(route.request().postDataJSON());
        return route.fulfill({ status: 202, json: { ok: true } });
      });
      await page.goto('/');
      await expect(
        page.getByRole('button', { name: 'Show prompt queue', exact: true }),
      ).toBeVisible();
      await expect(page.locator('.connection-notice')).toHaveCount(0);
      await page.evaluate(
        (next) =>
          (window as Sources).chatSource!.dispatchEvent(
            new MessageEvent('message', { data: JSON.stringify(next) }),
          ),
        snapshot,
      );
      await expect(page.getByRole('button', { name: 'Stop response', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Show task plan', exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole('button', { name: /^Search \// })).toHaveCount(0);
      await page.keyboard.press('Control+,');
      const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
      const queues = settings.getByRole('checkbox', { name: 'Enable prompt queues', exact: true });
      const plan = settings.getByRole('checkbox', { name: 'Show task plan bar', exact: true });
      await expect(queues).toBeChecked();
      await expect(plan).not.toBeChecked();
      failNextSave = true;
      await queues.click();
      await expect(settings).toContainText('Settings could not be saved');
      await expect(queues).toBeChecked();
      await plan.check();
      await queues.click();
      await expect(queues).not.toBeChecked();
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Show task plan', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Show prompt queue', exact: true }),
      ).toHaveCount(0);
      const composer = page.getByRole('textbox', { name: 'Message Pi', exact: true });
      await composer.fill('Keep my draft while queues are off');
      await composer.press('Enter');
      await expect(page.getByRole('alert')).toContainText('Prompt queues are disabled');
      await expect(composer).toHaveValue('Keep my draft while queues are off');
      await expect(page.getByRole('button', { name: 'Queue prompt', exact: true })).toHaveCount(0);
      expect(sent).toEqual([]);

      // Disabled queues do not block normal idle sends or force saved items to be enqueued.
      snapshot.busy = false;
      await page.evaluate(
        (next) =>
          (window as Sources).chatSource!.dispatchEvent(
            new MessageEvent('message', { data: JSON.stringify(next) }),
          ),
        snapshot,
      );
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await expect(composer).toHaveValue('');
      expect(sent).toEqual([{ text: 'Keep my draft while queues are off', enqueue: false }]);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Show task plan', exact: true })).toBeVisible();
      await expect(
        page.getByRole('button', { name: 'Show prompt queue', exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press('Control+,');
      await expect(queues).not.toBeChecked();
      await expect(plan).toBeChecked();
      await plan.uncheck();
      await queues.click();
      await expect(queues).toBeChecked();
      await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Show task plan', exact: true })).toHaveCount(
        0,
      );
      await page.getByRole('button', { name: 'Show prompt queue', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Resume queue', exact: true })).toBeVisible();

      // A newer installation policy from another tab overrides the local view; stale events do not.
      policy = { queuesEnabled: false, revision: policy.revision + 1 };
      await page.evaluate(
        (next) =>
          (window as Sources).globalSource!.dispatchEvent(
            new MessageEvent('message', {
              data: JSON.stringify({ type: 'settings', settings: next }),
            }),
          ),
        policy,
      );
      await expect(page.locator('.work-dock')).toBeHidden();
      await page.evaluate(() =>
        (window as Sources).globalSource!.dispatchEvent(
          new MessageEvent('message', {
            data: JSON.stringify({
              type: 'settings',
              settings: { queuesEnabled: true, revision: 0 },
            }),
          }),
        ),
      );
      await expect(page.locator('.work-dock')).toBeHidden();
      const persisted = await (await request.get(base)).json();
      expect(persisted.queue).toHaveLength(1);
      expect(persisted.queuePaused).toBe(true);
      expect(persisted.chat.plan).toHaveLength(1);
      expect(sent).toHaveLength(1);
    } finally {
      await request.delete(base, { data: {} });
    }
  });
}
