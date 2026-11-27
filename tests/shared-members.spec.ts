import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`owners restore revoked roles and can remove people with confirmation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const name = 'Guest with a longer installation name';
    let members = [
      { id: 'guest-installation', name, publicKey: 'fixture', role: 'writer', blocked: false },
    ];
    const decisions: string[] = [];
    await page.route('**/api/shared/sessions', (route) =>
      route.fulfill({
        json: {
          owner: { id: 'local', name: 'Owner', publicKey: 'fixture' },
          owned: [
            {
              id: 'owned-project',
              title: 'Managed project',
              enabled: true,
              role: 'owner',
              members,
              requests: [],
            },
          ],
          joined: [],
        },
      }),
    );
    await page.route('**/api/shared/sessions/owned-project/members/guest-installation', (route) => {
      if (route.request().method() === 'DELETE') {
        decisions.push('delete');
        members = [];
      } else {
        const role = route.request().postDataJSON().role;
        decisions.push(role);
        members = members.map((member) => ({
          ...member,
          blocked: role === 'removed',
          role: role === 'removed' ? member.role : role,
        }));
      }
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/');
    const open = page.getByRole('button', { name: 'Open sidebar', exact: true });
    if (await open.isVisible()) await open.click();
    await page.getByRole('tab', { name: 'Shared', exact: true }).click();
    await page
      .getByRole('button', { name: 'Manage shared session Managed project', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Shared session access', exact: true });
    const role = dialog.getByRole('combobox', { name: `Role for ${name}`, exact: true });
    await role.selectOption('removed');
    await expect(role).toHaveValue('removed');
    await role.selectOption('writer');
    await expect(role).toHaveValue('writer');
    await expect(dialog).toContainText('reconnect without an invitation');
    const remove = dialog.getByRole('button', { name: `Remove ${name} from session`, exact: true });
    page.once('dialog', (prompt) => prompt.dismiss());
    await remove.click();
    await expect(role).toBeVisible();
    expect(decisions).toEqual(['removed', 'writer']);
    page.once('dialog', async (prompt) => {
      expect(prompt.message()).toContain('Their access will be revoked');
      await prompt.accept();
    });
    await remove.click();
    await expect(dialog.getByText('No participants yet.', { exact: true })).toBeVisible();
    await expect(role).toHaveCount(0);
    expect(decisions).toEqual(['removed', 'writer', 'delete']);
    await dialog.getByRole('button', { name: 'Close Shared session access', exact: true }).click();
    await page.reload();
    await page
      .getByRole('button', { name: 'Manage shared session Managed project', exact: true })
      .click();
    await expect(dialog.getByText('No participants yet.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
