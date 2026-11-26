import { test, expect } from '@playwright/test';

for (const width of [1280, 390]) {
  test(`discovered sessions support request, approval and opening without an invitation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let requested = false,
      approved = false,
      polledApproval = false;
    const calls: unknown[] = [];
    const network = () => ({
      enabled: true,
      addresses: [{ name: 'LAN', address: '192.168.1.2' }],
      address: '192.168.1.2',
      port: 45479,
      peers: [
        {
          id: 'owner',
          name: 'Alice',
          address: '192.168.1.3',
          canRequest: true,
          sessions: [{ id: 'project', title: 'Discovered project' }],
        },
      ],
      requests: requested
        ? [
            {
              id: 'request',
              ownerId: 'owner',
              ownerName: 'Alice',
              sessionId: 'project',
              title: 'Discovered project',
              state: polledApproval ? 'approved' : 'pending',
              remoteId: polledApproval ? 'joined-project' : undefined,
            },
          ]
        : [],
    });
    await page.route('**/api/shared/sessions', (route) =>
      route.fulfill({
        json: {
          owner: { id: 'local', name: 'Bob', publicKey: 'fixture' },
          owned: [],
          joined: polledApproval
            ? [{ id: 'joined-project', ownerId: 'owner', title: 'Discovered project' }]
            : [],
        },
      }),
    );
    await page.route('**/api/shared/network', (route) => route.fulfill({ json: network() }));
    await page.route('**/api/shared/network/access', (route) => {
      calls.push(route.request().postDataJSON());
      requested = true;
      return route.fulfill({ json: network() });
    });
    await page.route('**/api/shared/network/access/poll', (route) => {
      polledApproval = approved;
      return route.fulfill({ json: network() });
    });
    await page.route('**/api/shared/joined/joined-project/rpc', (route) =>
      route.fulfill({
        json: {
          id: 'project',
          title: 'Discovered project',
          owner: { id: 'owner', name: 'Alice' },
          role: 'reader',
          messages: [{ role: 'assistant', text: 'Approved shared conversation' }],
          queue: [],
          queuePaused: false,
          queuesEnabled: true,
          busy: false,
        },
      }),
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Local network shared sessions', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Local network', exact: true });
    await expect(dialog.getByText(/unverified discovery/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Request access', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Request sent', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('region', { name: 'Your access requests', exact: true }),
    ).toContainText('Waiting for owner approval');
    expect(calls).toEqual([{ ownerId: 'owner', sessionId: 'project' }]);
    approved = true;
    await expect(
      dialog.getByRole('region', { name: 'Your access requests', exact: true }),
    ).toContainText('Access approved');
    await dialog.getByRole('button', { name: 'Open shared session', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Approved shared conversation', { exact: true })).toBeVisible();
    await expect(page.locator('.subtle-pill')).toHaveText('reader');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`owners can accept as writer or reject requests with an unobtrusive badge at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let requests = [
      {
        id: 'request-one',
        peer: { id: 'installation-one', name: 'Bob' },
        createdAt: new Date().toISOString(),
      },
      {
        id: 'request-two',
        peer: { id: 'installation-two', name: 'Carol' },
        createdAt: new Date().toISOString(),
      },
    ];
    const decisions: { id: string; role: unknown }[] = [];
    await page.route('**/api/shared/sessions', (route) =>
      route.fulfill({
        json: {
          owner: { id: 'local', name: 'Alice', publicKey: 'fixture' },
          owned: [
            {
              id: 'project',
              title: 'Owner project',
              enabled: true,
              role: 'owner',
              members: [],
              requests,
            },
          ],
          joined: [],
        },
      }),
    );
    await page.route('**/api/shared/network', (route) =>
      route.fulfill({
        json: {
          enabled: true,
          addresses: [{ name: 'LAN', address: '192.168.1.2' }],
          address: '192.168.1.2',
          port: 45479,
          peers: [],
          requests: [],
        },
      }),
    );
    await page.route('**/api/shared/sessions/project/requests/*', (route) => {
      const id = route.request().url().split('/').at(-1)!;
      decisions.push({ id, role: route.request().postDataJSON().role });
      requests = requests.filter((request) => request.id !== id);
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/');
    const ring = page.getByRole('button', { name: 'Local network shared sessions', exact: true });
    await expect(ring.locator('.network-request-badge')).toHaveText('2');
    await expect(
      page.getByRole('dialog', { name: 'Local network', exact: true }),
    ).not.toBeVisible();
    await ring.click();
    const pending = page.getByRole('region', { name: 'Pending access requests', exact: true });
    await expect(pending).toContainText('installation-one');
    await expect(pending).toContainText('Writers can run tools');
    const bob = pending.getByLabel('Access request from Bob', { exact: true });
    await expect(bob.getByRole('combobox')).toHaveValue('reader');
    await bob.getByRole('combobox').selectOption('writer');
    await bob.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(bob).toHaveCount(0);
    await expect(ring.locator('.network-request-badge')).toHaveText('1');
    await pending
      .getByLabel('Access request from Carol', { exact: true })
      .getByRole('button', { name: 'Reject request', exact: true })
      .click();
    await expect(pending).toHaveCount(0);
    await expect(ring.locator('.network-request-badge')).toHaveCount(0);
    expect(decisions).toEqual([
      { id: 'request-one', role: 'writer' },
      { id: 'request-two', role: null },
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
