import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const width of [1280, 390]) {
  test(`shared/private navigation never duplicates plan or queue at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const root = await mkdtemp(join(tmpdir(), 'chat-shared-navigation-'));
    const chats: string[] = [];
    const keyWarnings: string[] = [];
    page.on('console', (message) => {
      if (/same key|unique ["']key["']/.test(message.text())) keyWarnings.push(message.text());
    });
    try {
      const privateResponse = await request.post('/api/chats', { data: { cwd: process.cwd() } });
      expect(privateResponse.ok()).toBe(true);
      const privateChat = await privateResponse.json();
      chats.push(privateChat.id);
      const title = `Private navigation ${privateChat.id}`;
      expect((await request.patch(`/api/chats/${privateChat.id}`, { data: { title } })).ok()).toBe(
        true,
      );
      expect(
        (
          await request.patch(`/api/chats/${privateChat.id}`, {
            data: {
              plan: [
                { text: 'Private completed step', status: 'done' },
                { text: 'Private pending step', status: 'pending' },
              ],
            },
          })
        ).ok(),
      ).toBe(true);
      const sharedResponse = await request.post('/api/shared/sessions', {
        data: {
          folder: join(root, 'project'),
          title: `Shared navigation ${privateChat.id}`,
          trustWriters: true,
        },
      });
      expect(sharedResponse.ok()).toBe(true);
      const sharedChat = await sharedResponse.json();
      chats.push(sharedChat.id);
      expect(
        (
          await request.patch(`/api/chats/${sharedChat.id}`, {
            data: {
              plan: Array.from({ length: 3 }, (_, index) => ({
                text: `Shared pending step ${index + 1}`,
                status: 'pending',
              })),
            },
          })
        ).ok(),
      ).toBe(true);
      for (const chat of [privateChat, sharedChat]) {
        expect(
          (await request.patch(`/api/chats/${chat.id}/queue`, { data: { paused: true } })).ok(),
        ).toBe(true);
        for (let index = 0; index < (chat.id === privateChat.id ? 2 : 1); index++) {
          expect(
            (
              await request.post(`/api/chats/${chat.id}/messages`, {
                data: {
                  text: `${chat.id === privateChat.id ? 'Private' : 'Shared'} queued prompt ${index + 1}`,
                  enqueue: true,
                },
              })
            ).ok(),
          ).toBe(true);
        }
      }
      await page.addInitScript((id) => {
        localStorage.setItem('pi-chat-active', id);
        localStorage.setItem('pi-chat-settings', JSON.stringify({ showTaskPlan: true }));
      }, privateChat.id);
      await page.goto('/');
      async function openSidebar() {
        const button = page.getByRole('button', { name: 'Open sidebar', exact: true });
        if (await button.isVisible()) await button.click();
      }
      async function verifyDock(shared: boolean) {
        const dock = page.locator('.work-dock');
        await expect(
          page.getByRole('button', { name: 'Show task plan', exact: true }),
        ).toContainText(shared ? '0/3' : '1/2');
        await expect(dock).toHaveCount(1);
        await expect(page.getByLabel('Plan and queue', { exact: true })).toHaveCount(1);
        await expect(
          page.getByRole('button', { name: 'Show prompt queue', exact: true }),
        ).toContainText(shared ? '1 queued' : '2 queued');
        await expect(
          page.getByRole('region', { name: 'Work details', exact: true, includeHidden: true }),
        ).toHaveCount(1);
        if (width < 760) {
          const close = page.getByRole('button', { name: 'Close sidebar', exact: true });
          if (await close.isVisible()) await close.click();
        }
        await page.getByRole('button', { name: 'Show task plan', exact: true }).click();
        const plan = page.getByRole('region', { name: 'Task plan', exact: true });
        await expect(plan).toHaveCount(1);
        await expect(plan).toContainText(shared ? 'Shared pending step 1' : 'Private pending step');
        await expect(plan).not.toContainText(
          shared ? 'Private pending step' : 'Shared pending step',
        );
        await page.getByRole('button', { name: 'Show prompt queue', exact: true }).click();
        const queue = page.getByRole('region', { name: 'Prompt queue', exact: true });
        await expect(queue).toHaveCount(1);
        await expect(queue).toContainText(
          shared ? 'Shared queued prompt 1' : 'Private queued prompt 1',
        );
        await page.keyboard.press('Escape');
        await expect(page.getByRole('region', { name: 'Work details', exact: true })).toHaveCount(
          0,
        );
      }
      await verifyDock(false);
      for (let round = 0; round < 3; round++) {
        await openSidebar();
        await page.getByRole('tab', { name: 'Shared', exact: true }).click();
        await page
          .locator('.shared-session-list')
          .getByRole('button', { name: new RegExp(`^Shared navigation ${privateChat.id}`) })
          .click();
        await expect(page.locator('.topbar .subtle-pill')).toContainText('Shared · Owner');
        await verifyDock(true);
        await openSidebar();
        await page.getByRole('tab', { name: 'Chats', exact: true }).click();
        await page.locator('.chat-item').filter({ hasText: title }).locator('.chat-select').click();
        await expect(page.locator('.topbar .page-title')).toHaveText(title);
        await verifyDock(false);
      }
      expect(keyWarnings).toEqual([]);
    } finally {
      for (const id of chats) await request.delete(`/api/chats/${id}`, { data: {} });
      await rm(root, { recursive: true, force: true });
    }
  });
}
