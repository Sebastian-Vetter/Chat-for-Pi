import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  for (const role of ['owner', 'writer', 'reader']) {
    test(`${role} sees shared typing names above the input at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const id = '00000000-0000-4000-8000-000000000009';
      const identity = { id: 'local', name: 'Myself', publicKey: 'fixture' };
      let people = [
        { id: 'local', name: 'Myself' },
        { id: 'alice', name: 'Alice' },
        { id: 'bob', name: 'Bob' },
      ];
      const reports: { active: boolean; client: string }[] = [];
      const chat = {
        id,
        title: 'Typing project',
        cwd: process.cwd(),
        shared: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const snapshot = {
        chat,
        messages: [],
        queue: [],
        queuePaused: false,
        busy: false,
        events: [],
        approvals: [],
      };
      await page.addInitScript(
        ({ id, owner }) => {
          if (owner) localStorage.setItem('pi-chat-active', id);
          else localStorage.removeItem('pi-chat-active');
        },
        { id, owner: role === 'owner' },
      );
      await page.route('**/api/shared/sessions', (route) =>
        route.fulfill({
          json: {
            owner: identity,
            owned:
              role === 'owner'
                ? [{ id, title: chat.title, enabled: true, role: 'owner', members: [] }]
                : [],
            joined: role === 'owner' ? [] : [{ id, title: chat.title, ownerId: 'alice' }],
          },
        }),
      );
      if (role === 'owner') {
        await page.route('**/api/chats', (route) => route.fulfill({ json: [chat] }));
        await page.route(`**/api/chats/${id}`, (route) => route.fulfill({ json: snapshot }));
        await page.route(`**/api/chats/${id}/events`, (route) =>
          route.fulfill({
            contentType: 'text/event-stream',
            body: `data: ${JSON.stringify(snapshot)}\n\n`,
          }),
        );
        await page.route(`**/api/shared/sessions/${id}/typing`, (route) => {
          if (route.request().method() === 'GET') return route.fulfill({ json: people });
          reports.push(route.request().postDataJSON());
          return route.fulfill({ json: { ok: true } });
        });
      } else {
        await page.route(`**/api/shared/joined/${id}/rpc`, (route) => {
          const { operation, data } = route.request().postDataJSON();
          if (operation === 'typing') {
            reports.push(data);
            return route.fulfill({ json: { ok: true } });
          }
          return route.fulfill({
            json: {
              ...snapshot,
              id,
              title: chat.title,
              role,
              owner: { id: 'alice', name: 'Alice' },
              typing: people,
              queuesEnabled: true,
            },
          });
        });
      }
      await page.goto('/');
      if (role !== 'owner') {
        if (width < 760)
          await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
        await page.getByRole('tab', { name: 'Shared', exact: true }).click();
        await page
          .locator('.shared-session-list')
          .getByRole('button', { name: /^Typing project/ })
          .click();
      }
      const indicator = page.locator('.shared-typing');
      await expect(indicator).toHaveText('Alice and Bob are typing…');
      await expect(indicator).toHaveAttribute('aria-live', 'polite');
      const input = page.getByRole('textbox', {
        name: role === 'owner' ? 'Message Pi' : 'Message shared session',
        exact: true,
      });
      if (role === 'reader') {
        await expect(input).toHaveCount(0);
        expect(reports).toEqual([]);
      } else {
        const label = (await indicator.boundingBox())!,
          box = (await input.boundingBox())!;
        expect(label.y + label.height).toBeLessThanOrEqual(box.y);
        await input.fill('Private unsent draft');
        await expect.poll(() => reports.some((report) => report.active)).toBe(true);
        await expect.poll(() => reports.at(-1)?.active, { timeout: 6500 }).toBe(false);
        await expect(input).toHaveValue('Private unsent draft');
        await input.fill('Still private, still not sent');
        await expect.poll(() => reports.at(-1)?.active).toBe(true);
        await input.press('Tab');
        await expect.poll(() => reports.at(-1)?.active).toBe(false);
        expect(JSON.stringify(reports)).not.toMatch(/Private unsent|Still private|text|draft/i);
        for (const report of reports)
          expect(Object.keys(report).sort()).toEqual(['active', 'client']);
      }
      people = [];
      await expect(indicator).toHaveText('');
      people = [{ id: 'alice', name: 'Alice' }];
      await expect(indicator).toHaveText('Alice is typing…');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}
