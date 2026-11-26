import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  for (const role of ['reader', 'writer']) {
    test(`shared ${role} uses padded bounded chat layout at ${width}px`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      let unavailable = false;
      const title =
        'A shared project with a deliberately long title to verify the header layout on narrow screens';
      await page.addInitScript(() => localStorage.removeItem('pi-chat-active'));
      await page.route('**/api/shared/sessions', (route) =>
        route.fulfill({
          json: {
            owner: { id: 'local', name: 'Local user', publicKey: 'fixture' },
            owned: [],
            joined: [{ id: 'layout-fixture', title, ownerId: 'owner' }],
          },
        }),
      );
      await page.route('**/api/shared/joined/layout-fixture/rpc', (route) => {
        if (unavailable)
          return route.fulfill({
            status: 400,
            json: {
              error:
                'The shared owner is unavailable. Please check the LAN connection and try again.',
            },
          });
        return route.fulfill({
          json: {
            id: 'remote',
            title,
            owner: { id: 'owner', name: 'Alex'.repeat(15) },
            role,
            historyLimited: true,
            messages: [
              { role: 'user', text: 'Please review the shared project and explain the changes.' },
              {
                role: 'assistant',
                text: `## Shared project update\n\nThe project is ready for review. Conversation spacing and the composer should match the private chat.\n\n\`\`\`typescript\nconst example = "${'long_value_'.repeat(60)}";\n\`\`\`\n\nThe long code line scrolls inside its own block, not across the whole page.`,
              },
            ],
            queue: [],
            queuePaused: false,
            queuesEnabled: true,
            busy: false,
          },
        });
      });
      await page.goto('/');
      if (width < 760)
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      await page.getByRole('tab', { name: 'Shared', exact: true }).click();
      await page
        .locator('.shared-session-list')
        .getByRole('button', { name: new RegExp(`^${title}`) })
        .click();
      await expect(page.locator('.subtle-pill')).toHaveText(role);
      await expect(page.locator('.subtle-pill')).toBeVisible();
      const viewport = page.getByRole('region', { name: 'Shared conversation', exact: true });
      const messages = page.getByRole('region', { name: 'Shared messages', exact: true });
      await expect(messages).toContainText('The project is ready for review');
      if (role === 'writer')
        await expect(
          page.getByRole('textbox', { name: 'Message shared session', exact: true }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole('textbox', { name: 'Message shared session', exact: true }),
        ).toHaveCount(0);
      async function checkLayout() {
        const layout = await page.evaluate(() => {
          const box = (selector: string) =>
            document.querySelector(selector)!.getBoundingClientRect();
          const main = box('.main-panel'),
            transcript = box('.shared-remote-transcript .transcript');
          const body = box('.shared-remote-transcript .assistant-message .message-body');
          const footer = box('.shared-remote-footer'),
            note = box('.shared-remote-meta .shared-owner');
          const footerContent = box('.shared-remote-footer .composer, .shared-reader-note');
          const viewport = box('.shared-remote-transcript');
          const header = box('.shared-remote-topbar'),
            refresh = box('[aria-label="Refresh shared session"]');
          const menu = document
            .querySelector('.shared-remote-topbar [aria-label="Open sidebar"]')
            ?.getBoundingClientRect();
          return {
            fits: document.documentElement.scrollWidth <= innerWidth,
            transcriptWidth: transcript.width,
            footerWidth: footer.width,
            messageLeft: body.left - main.left,
            messageRight: main.right - body.right,
            footerLeft: footerContent.left - main.left,
            footerRight: main.right - footerContent.right,
            ownerLeft: note.left - main.left,
            ownerRight: main.right - note.right,
            noOverlap: viewport.bottom <= footer.top + 1,
            visibleHeight: viewport.height,
            footerBottom: footer.bottom,
            headerFits:
              refresh.right <= main.right - 8 &&
              (!menu || (menu.top >= header.top && menu.bottom <= header.bottom)),
          };
        });
        expect(layout.fits).toBe(true);
        expect(layout.transcriptWidth).toBeLessThanOrEqual(795);
        expect(layout.footerWidth).toBeLessThanOrEqual(855);
        for (const margin of [
          layout.messageLeft,
          layout.messageRight,
          layout.footerLeft,
          layout.footerRight,
          layout.ownerLeft,
          layout.ownerRight,
        ])
          expect(margin).toBeGreaterThanOrEqual(13);
        expect(layout.noOverlap).toBe(true);
        expect(layout.visibleHeight).toBeGreaterThan(64);
        expect(layout.footerBottom).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
        expect(layout.headerFits).toBe(true);
      }
      await checkLayout();
      await page.screenshot({ path: testInfo.outputPath('shared-chat.png') });
      if (role === 'writer') {
        await page
          .getByRole('textbox', { name: 'Message shared session', exact: true })
          .fill(Array.from({ length: 14 }, (_, index) => `Draft line ${index + 1}`).join('\n'));
        await expect
          .poll(
            async () =>
              (
                await page
                  .getByRole('textbox', { name: 'Message shared session', exact: true })
                  .boundingBox()
              )?.height ?? 0,
          )
          .toBeLessThanOrEqual(181);
      }
      await page.setViewportSize({ width, height: 560 });
      await checkLayout();
      await expect(viewport).toBeVisible();
      unavailable = true;
      await page.getByRole('button', { name: 'Refresh shared session', exact: true }).click();
      const error = page.getByRole('alert');
      await expect(error).toContainText('The shared owner is unavailable');
      const errorBox = (await error.boundingBox())!;
      const mainBox = (await page.locator('.main-panel').boundingBox())!;
      expect(errorBox.x - mainBox.x).toBeGreaterThanOrEqual(13);
      expect(errorBox.x + errorBox.width).toBeLessThanOrEqual(mainBox.x + mainBox.width - 13);
    });
  }
}
