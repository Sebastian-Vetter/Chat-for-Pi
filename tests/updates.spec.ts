import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const version: string = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

for (const width of [1280, 390]) {
  test(`update notice shows release notes and explicit safe instructions at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const parts = version.split('.').map(Number); parts[2]++; const latest = parts.join('.');
    const data = { current: version, latest, status: 'available', checkedAt: new Date().toISOString(), notes: '## New release\n\nResearch improvements.\n\n![tracking](https://tracking.invalid/image)', releaseUrl: `https://github.com/Sebastian-Vetter/Chat-for-Pi/releases/tag/v${latest}`, downloadUrl: `https://github.com/Sebastian-Vetter/Chat-for-Pi/releases/download/v${latest}/pi-chat-extension-${latest}.tgz` };
    let installs = 0, remoteImages = 0;
    await page.route('**/api/updates', route => route.fulfill({ json: data }));
    await page.route('**/api/updates/check', route => route.fulfill({ json: { ...data, status: 'unavailable', message: 'GitHub returned HTTP 403. Try again later.', notes: undefined } }));
    await page.route('https://tracking.invalid/**', route => { remoteImages++; return route.abort(); });
    page.on('request', request => { if (/\/api\/.*(install|restart|stop)/.test(request.url())) installs++; });
    await page.goto('/');
    await expect(page.getByText(`Version ${latest} available`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Release notes & update', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Updates and releases' });
    await expect(dialog).toContainText(`Installed web app: v${version}`);
    await expect(dialog).toContainText('Research improvements.');
    await expect(dialog).toContainText(`pi install git:github.com/Sebastian-Vetter/Chat-for-Pi@v${latest}`);
    await expect(dialog).toContainText('No automatic installation or restart.');
    await expect(dialog.getByRole('link', { name: 'Download Pi package' })).toHaveAttribute('href', data.downloadUrl);
    expect(remoteImages).toBe(0); expect(installs).toBe(0);
    await dialog.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await expect(dialog).toContainText('GitHub returned HTTP 403');
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    expect(installs).toBe(0);
  });
}
test('release checker stays accessible through settings when checks are disabled', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: 'Updates & releases', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Updates and releases' });
  await expect(dialog).toContainText('CHAT_UPDATE_CHECK=0');
  await expect(dialog.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
});
