import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`subscription limits show actual 5-hour/weekly allowances and resets at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    let requests = 0;
    await page.route('**/api/usage-limits/check', (route) => {
      requests++;
      const provider = route.request().postDataJSON().provider;
      return route.fulfill({
        json:
          provider === 'openai-codex'
            ? {
                provider,
                status: 'ok',
                checkedAt: '2026-12-01T10:00:00Z',
                fiveHour: { usedPercent: 25, resetsAt: '2026-12-01T13:00:00Z' },
                weekly: { usedPercent: 70, resetsAt: '2026-12-06T10:00:00Z' },
              }
            : {
                provider,
                status: 'signin-required',
                checkedAt: '2026-12-01T10:00:00Z',
                message: 'Subscription limits require an OAuth login in Pi.',
              },
      });
    });
    await page.goto('/');
    expect(requests).toBe(0);
    await page.getByRole('button', { name: 'Usage limits', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Subscription usage limits', exact: true });
    const fiveHour = dialog.getByRole('region', { name: '5-hour limit', exact: true });
    const weekly = dialog.getByRole('region', { name: 'Weekly limit', exact: true });
    await expect(fiveHour).toContainText('75% remaining');
    await expect(weekly).toContainText('30% remaining');
    await expect(fiveHour.getByRole('progressbar')).toHaveAttribute('value', '25');
    await expect(weekly.locator('time')).toHaveAttribute('datetime', '2026-12-06T10:00:00Z');
    await expect(dialog).toContainText('including usage outside this chat');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const beforeRefresh = requests;
    await dialog.getByRole('button', { name: 'Refresh limits', exact: true }).click();
    await expect.poll(() => requests).toBe(beforeRefresh + 1);
    await dialog.getByRole('combobox', { name: 'Subscription provider' }).selectOption('anthropic');
    await expect(dialog).toContainText('require an OAuth login');
    await expect(fiveHour).toContainText('Not reported');
    await expect(weekly).not.toContainText('30% remaining');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
}
