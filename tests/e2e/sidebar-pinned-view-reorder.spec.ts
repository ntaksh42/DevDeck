import { expect, test } from '@playwright/test';

test('reorders pinned Views in the sidebar and shares their saved order with Views', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'azdodeck:workItemQueryViews';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify(['Alpha', 'Bravo', 'Charlie'].map((name) => ({
      id: name.toLowerCase(), name, projectId: '', wiql: 'SELECT [System.Id] FROM WorkItems', pinned: name !== 'Bravo',
    }))));
  });
  const pins = page.locator('[data-pinned-view]');
  const pinOrder = () => pins.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-pinned-view')));
  const navOrder = () => page.locator('[data-nav-entry]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-nav-entry')));
  const alpha = pins.locator('button[data-nav-label="Alpha"]');
  const charlie = pins.locator('button[data-nav-label="Charlie"]');
  await page.goto('/');
  await expect.poll(pinOrder).toEqual(['alpha', 'charlie']);
  const before = await navOrder();
  await charlie.dragTo(alpha);
  await expect.poll(pinOrder).toEqual(['charlie', 'alpha']);
  await expect.poll(navOrder).toEqual(before);
  await expect(page.getByRole('grid', { name: 'My review pull requests' })).toBeVisible();

  await page.keyboard.press('g');
  await page.keyboard.press('v');
  const list = page.getByRole('listbox', { name: 'Saved work item views' });
  const views = list.getByRole('option');
  await expect(views).toHaveText([/Charlie/, /Alpha/, /Bravo/]);
  await alpha.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(pinOrder).toEqual(['alpha', 'charlie']);
  await expect(alpha).toBeFocused();
  await expect(views).toHaveText([/Alpha/, /Charlie/, /Bravo/]);

  await page.reload();
  await expect.poll(pinOrder).toEqual(['alpha', 'charlie']);
  await expect(page.getByRole('grid', { name: 'My review pull requests' })).toBeVisible();
  await page.keyboard.press('g');
  await page.keyboard.press('v');
  await expect(views).toHaveText([/Alpha/, /Charlie/, /Bravo/]);
});
