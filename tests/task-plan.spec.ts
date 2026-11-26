import { test, expect, type APIResponse } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const width of [1280, 390]) {
  test(`pending plan steps can be added and reordered during active work at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
    const cwd = await mkdtemp(join(tmpdir(), 'pi-chat-plan-ui-'));
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({
        scripts: { test: 'node -e "throw new Error(\'This task must never start\')"' },
      }),
    );
    const chat = await (await request.post('/api/chats', { data: { cwd } })).json();
    const base = `/api/chats/${chat.id}`;
    const steps = [
      { text: 'A', status: 'pending' },
      { text: 'Running', status: 'running' },
      { text: 'B', status: 'pending' },
      { text: 'Done', status: 'done' },
      { text: 'C', status: 'pending' },
    ];
    let waiting: Promise<APIResponse> | undefined;
    try {
      await request.patch(base, { data: { plan: steps } });
      await request.patch(base, { data: { approvalMode: true } });
      await page.addInitScript((id) => localStorage.setItem('pi-chat-active', id), chat.id);
      await page.goto('/');
      const plan = page.locator('.task-plan');
      const labels = plan.locator('.plan-step-text');
      await expect(labels).toHaveText(['A', 'Running', 'B', 'Done', 'C']);
      waiting = request.post(`${base}/tests`, { data: { taskId: 'package:test' } });
      await expect(
        page.getByRole('region', { name: 'Approval for configured_test', exact: true }),
      ).toBeVisible();
      await expect(
        plan.getByRole('button', { name: 'Change status of Running', exact: true }),
      ).toBeDisabled();
      await expect(
        plan.getByRole('button', { name: 'Remove step Done', exact: true }),
      ).toBeDisabled();
      await expect(plan.getByRole('button', { name: /^Drag pending step / })).toHaveCount(3);
      await expect(
        plan.getByRole('button', { name: 'Move step up: A', exact: true }),
      ).toBeDisabled();
      await expect(
        plan.getByRole('button', { name: 'Move step down: C', exact: true }),
      ).toBeDisabled();
      expect(
        (
          await request.patch(`${base}/plan`, {
            data: { revision: 1, action: 'status', index: 0, status: 'running' },
          })
        ).status(),
      ).toBe(409);
      expect(
        (
          await request.patch(`${base}/plan`, { data: { revision: 1, action: 'remove', index: 0 } })
        ).status(),
      ).toBe(409);
      expect(
        (
          await request.patch(`${base}/plan`, {
            data: { revision: 1, action: 'move', index: 1, targetIndex: 0 },
          })
        ).status(),
      ).toBe(409);

      const input = plan.getByRole('textbox', { name: 'New plan step', exact: true });
      await expect(input).toBeEnabled();
      await input.fill('Added during work');
      await plan.getByRole('button', { name: 'Add step', exact: true }).click();
      await expect(labels).toHaveText(['A', 'Running', 'B', 'Done', 'C', 'Added during work']);
      await input.fill('Keep this draft');
      await plan.getByRole('button', { name: 'Move step up: C', exact: true }).click();
      await expect(labels).toHaveText(['A', 'Running', 'C', 'Done', 'B', 'Added during work']);
      await expect(
        plan.getByRole('button', { name: 'Move step up: C', exact: true }),
      ).toBeFocused();
      await expect(input).toHaveValue('Keep this draft');
      await plan.getByRole('button', { name: 'Move step down: C', exact: true }).focus();
      await page.keyboard.press('Enter');
      await expect(labels).toHaveText(['A', 'Running', 'B', 'Done', 'C', 'Added during work']);

      await expect(plan).toHaveAttribute('aria-busy', 'false');
      if (width === 1280) {
        await plan
          .getByRole('button', { name: 'Drag pending step Added during work', exact: true })
          .dragTo(plan.locator('li').first());
      } else {
        for (let move = 0; move < 3; move++) {
          await plan
            .getByRole('button', { name: 'Move step up: Added during work', exact: true })
            .click();
          await expect(plan).toHaveAttribute('aria-busy', 'false');
        }
      }
      const ordered = ['Added during work', 'Running', 'A', 'Done', 'B', 'C'];
      await expect(labels).toHaveText(ordered);
      await expect(input).toHaveValue('Keep this draft');
      await expect(plan.getByRole('status')).toContainText('Pending step moved');

      // Another browser edits the plan after this page submits but before it reaches the API.
      await page.route(
        `**${base}/plan`,
        async (route) => {
          const latest = await (await request.get(base)).json();
          const added = await request.patch(`${base}/plan`, {
            data: { revision: latest.chat.planRevision, action: 'add', text: 'From another tab' },
          });
          expect(added.status()).toBe(200);
          await route.continue();
        },
        { times: 1 },
      );
      await plan.getByRole('button', { name: 'Move step up: C', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('The task plan changed');
      await expect(labels).toHaveText([...ordered, 'From another tab']);
      await expect(input).toHaveValue('Keep this draft');
      await page.reload();
      await expect(labels).toHaveText([...ordered, 'From another tab']);

      // A live update invalidates a drag that began against an older revision.
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await plan
        .getByRole('button', { name: 'Drag pending step C', exact: true })
        .dispatchEvent('dragstart', { dataTransfer: transfer });
      await plan.locator('li').first().dispatchEvent('dragover', { dataTransfer: transfer });
      await expect(plan.locator('.plan-drop-target')).toHaveCount(1);
      const beforeDragUpdate = await (await request.get(base)).json();
      await request.patch(`${base}/plan`, {
        data: {
          revision: beforeDragUpdate.chat.planRevision,
          action: 'add',
          text: 'Arrived during drag',
        },
      });
      await expect(plan.getByRole('status')).toContainText('changed while dragging');
      await expect(plan.locator('.plan-drop-target')).toHaveCount(0);
      await plan.locator('li').first().dispatchEvent('drop', { dataTransfer: transfer });
      await expect(labels).toHaveText([...ordered, 'From another tab', 'Arrived during drag']);
      await transfer.dispose();
      const snapshot = await (await request.get(base)).json();
      expect(snapshot.chat.plan[1]).toEqual(steps[1]);
      expect(snapshot.chat.plan[3]).toEqual(steps[3]);
      expect(snapshot.queue).toEqual([]);
      expect(snapshot.messages).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    } finally {
      await request.post(`${base}/tests/stop`, { data: {} });
      await waiting?.catch(() => {});
      await request.delete(base, { data: {} });
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
