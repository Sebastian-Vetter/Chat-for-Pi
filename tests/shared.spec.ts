import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const width of [1280, 390]) {
  test(`shared projects use an empty folder, permanent icon, sidebar files and opt-in LAN at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const root = await mkdtemp(join(tmpdir(), 'chat-shared-ui-'));
    let id: string | undefined;
    try {
      const occupied = join(root, 'occupied');
      await mkdir(occupied);
      await writeFile(join(occupied, '.hidden'), 'private');
      await page.goto('/');
      if (width < 760)
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      await page.getByRole('tab', { name: 'Shared', exact: true }).click();
      await page.getByRole('button', { name: 'New shared project', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'New shared project', exact: true });
      await dialog
        .getByRole('textbox', { name: 'Shared session name', exact: true })
        .fill('Collaborative project');
      await dialog
        .getByRole('textbox', { name: 'Empty shared project folder', exact: true })
        .fill(occupied);
      await expect(
        dialog.getByRole('button', { name: 'Create shared project', exact: true }),
      ).toBeDisabled();
      await dialog.getByRole('checkbox', { name: 'Trust shared writers', exact: true }).check();
      await dialog.getByRole('button', { name: 'Create shared project', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('must be empty');
      const project = join(root, 'project');
      await dialog
        .getByRole('textbox', { name: 'Empty shared project folder', exact: true })
        .fill(project);
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/shared/sessions') &&
          response.request().method() === 'POST' &&
          response.ok(),
      );
      await dialog.getByRole('button', { name: 'Create shared project', exact: true }).click();
      id = (await (await created).json()).id;
      await expect(dialog).not.toBeVisible();
      await expect(page.locator('.topbar .subtle-pill')).toContainText('Shared · Owner');
      if (
        width < 760 &&
        (await page.getByRole('button', { name: 'Open sidebar', exact: true }).isVisible())
      )
        await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
      await page.getByRole('button', { name: /^Files/ }).click();
      page.once('dialog', (dialog) => dialog.accept('README.md'));
      await page.getByRole('button', { name: 'New shared file', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Shared file README.md', exact: true });
      await editor
        .getByRole('textbox', { name: 'Shared file content', exact: true })
        .fill('# Shared project\n');
      await editor.getByRole('button', { name: 'Save file', exact: true }).click();
      await expect(editor.getByRole('button', { name: 'Save file', exact: true })).toBeDisabled();
      await expect
        .poll(async () => readFile(join(project, 'README.md'), 'utf8').catch(() => ''))
        .toBe('# Shared project\n');
      await editor.getByRole('button', { name: 'Close shared file', exact: true }).click();
      await page.getByLabel('Upload shared file', { exact: true }).setInputFiles({
        name: 'note.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Uploaded note'),
      });
      await expect(
        page.locator('.shared-file-list').getByRole('button', { name: 'note.txt', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Manage shared session Collaborative project', exact: true })
        .click();
      const access = page.getByRole('dialog', { name: 'Shared session access', exact: true });
      await expect(
        access.getByRole('button', { name: 'Turn sharing on', exact: true }),
      ).toBeVisible();
      await access.getByRole('button', { name: 'Turn sharing on', exact: true }).click();
      await expect(
        access.getByRole('button', { name: 'Turn sharing off', exact: true }),
      ).toBeVisible();
      await access.getByRole('button', { name: 'Turn sharing off', exact: true }).click();
      await expect(
        access.getByRole('button', { name: 'Turn sharing on', exact: true }),
      ).toBeVisible();
      await access
        .getByRole('button', { name: 'Close Shared session access', exact: true })
        .click();
      expect((await request.post('/api/chats', { data: { cwd: project } })).status()).toBe(409);
      await page.reload();
      await expect(page.locator('.topbar .subtle-pill')).toContainText('Shared · Owner');
      expect((await (await request.get(`/api/chats/${id}`)).json()).chat.shared).toBe(true);
      expect((await (await request.get('/api/shared/network')).json()).enabled).toBe(false);
      expect(await readFile(join(occupied, '.hidden'), 'utf8')).toBe('private');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    } finally {
      if (id) await request.delete(`/api/chats/${id}`, { data: {} });
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('first startup requires a display name and retains the installation identity', async ({
  page,
}) => {
  let name = '';
  const identity = { id: '00000000-0000-4000-8000-000000000001', publicKey: 'fixture' };
  await page.route('**/api/shared/sessions', (route) =>
    route.fulfill({ json: { owner: { ...identity, name }, owned: [], joined: [] } }),
  );
  await page.route('**/api/shared/identity', (route) => {
    name = route.request().postDataJSON().name;
    return route.fulfill({ json: { ...identity, name } });
  });
  await page.goto('/');
  const setup = page.getByRole('dialog', { name: 'Welcome to Chat for Pi', exact: true });
  await expect(setup).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(setup).toBeVisible();
  await expect(setup).toContainText(identity.id);
  await setup.getByRole('textbox', { name: 'Your display name', exact: true }).fill('Alice');
  await setup.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(setup).not.toBeVisible();
  await page.reload();
  await expect(setup).not.toBeVisible();
});

test('joined reader/writer views are distinct and role revocation removes write and file controls', async ({
  page,
}) => {
  let role = 'reader';
  let revoked = false,
    busy = false;
  const messages: string[] = [];
  await page.route('**/api/shared/sessions', (route) =>
    route.fulfill({
      json: {
        owner: { id: 'local', name: 'Local user', publicKey: 'fixture' },
        owned: [],
        joined: [{ id: 'joined-fixture', title: 'Remote project', ownerId: 'owner' }],
      },
    }),
  );
  await page.route('**/api/shared/joined/joined-fixture/rpc', (route) => {
    const { operation, data } = route.request().postDataJSON();
    if (revoked) return route.fulfill({ status: 400, json: { error: 'Access revoked' } });
    if (operation === 'snapshot')
      return route.fulfill({
        json: {
          id: 'remote',
          title: 'Remote project',
          owner: { id: 'owner', name: 'Alice' },
          role,
          messages: [
            {
              role: 'assistant',
              text: 'Shared reply\n![Tracking image](http://127.0.0.1:5174/shared-tracking-pixel)',
            },
          ],
          queue: [],
          queuePaused: false,
          queuesEnabled: !busy,
          busy,
        },
      });
    if (operation === 'list')
      return route.fulfill({ json: [{ name: 'README.md', directory: false, size: 5 }] });
    if (operation === 'read')
      return route.fulfill({
        json: { data: Buffer.from('Hello').toString('base64'), hash: 'fixture' },
      });
    if (operation === 'message') {
      if (busy)
        return route.fulfill({ status: 400, json: { error: 'Prompt queues are disabled' } });
      messages.push(data.text);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 403, json: { error: 'Not allowed in this fixture' } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Shared', exact: true }).click();
  await page
    .locator('.shared-session-list')
    .getByRole('button', { name: /^Remote project/ })
    .click();
  await expect(page.locator('.subtle-pill')).toHaveText('reader');
  await expect(page.locator('.shared-remote-transcript img')).toHaveCount(0);
  await expect(page.locator('.shared-remote-transcript')).toContainText(
    'use shared files to download',
  );
  await expect(page.getByText('Owner · Alice', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Message shared session', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /^Files/ }).click();
  await expect(page.getByRole('button', { name: 'New shared file', exact: true })).toHaveCount(0);
  await page
    .locator('.shared-file-list')
    .getByRole('button', { name: 'README.md', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Shared file content', exact: true }),
  ).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Close shared file', exact: true }).click();
  role = 'writer';
  await page.getByRole('button', { name: 'Refresh shared session', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Message shared session', exact: true })
    .fill('Help with this project');
  await page.getByRole('button', { name: 'Send to shared session', exact: true }).click();
  await expect.poll(() => messages).toEqual(['Help with this project']);
  await expect(page.getByRole('button', { name: 'New shared file', exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message shared session', exact: true });
  await expect(composer).toHaveValue('');
  await composer.fill('Sent with Enter');
  await composer.press('Enter');
  await expect.poll(() => messages).toEqual(['Help with this project', 'Sent with Enter']);
  await expect(composer).toHaveValue('');
  busy = true;
  await page.getByRole('button', { name: 'Refresh shared session', exact: true }).click();
  await expect(page.locator('.shared-owner')).toContainText('Working');
  await composer.fill('Keep this draft');
  await expect(
    page.getByRole('button', { name: 'Send to shared session', exact: true }),
  ).toBeDisabled();
  await composer.press('Enter');
  await expect(page.getByRole('alert')).toContainText('your draft is kept');
  await expect(composer).toHaveValue('Keep this draft');
  expect(messages).toEqual(['Help with this project', 'Sent with Enter']);
  revoked = true;
  await page.getByRole('button', { name: 'Refresh shared session', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Access revoked');
  await expect(
    page.getByRole('textbox', { name: 'Message shared session', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Files/ })).toHaveCount(0);
});
