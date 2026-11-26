import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`conversation actions stay quiet without removed features at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let checks = 0;
    await page.route('**/api/usage-limits/check', (route) => {
      checks++;
      return route.fulfill({ status: 500, json: { error: 'Must not be requested' } });
    });
    // Previously saved templates must not restore controls or silently expand prompts.
    await page.addInitScript(() =>
      localStorage.setItem(
        'pi-chat-prompt-templates',
        JSON.stringify([
          { name: 'Old template', shortcut: '/old-template', text: 'Old expansion' },
        ]),
      ),
    );
    await page.goto('/');
    const actions = page.locator('.conversation-actions');
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('button')).toHaveCount(2);
    const exportButton = actions.getByRole('button', { name: 'Export chat', exact: true });
    await expect(exportButton).toHaveText('');
    await expect(exportButton).toHaveAttribute('title', 'Export chat as Markdown');
    await expect(exportButton).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Require action approvals' })).toHaveCount(0);
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    for (const query of ['Usage limits', 'Prompt templates', 'Old template', 'Require approvals']) {
      await palette.getByRole('combobox').fill(query);
      await expect(palette.getByRole('option')).toHaveCount(0);
    }
    await page.keyboard.press('Escape');
    expect(checks).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
