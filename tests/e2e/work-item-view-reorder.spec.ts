import { expect, test } from '@playwright/test';

test('reorders saved view cards and compact rows and remembers their order', async ({ page }) => {
  await page.addInitScript(() => {
    const key = 'azdodeck:workItemQueryViews';
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify(['Alpha', 'Bravo', 'Charlie'].map((name) => ({
      id: name.toLowerCase(), name, projectId: '', wiql: 'SELECT [System.Id] FROM WorkItems',
    }))));
  });

  async function openViews() {
    await page.getByRole('grid', { name: 'My review pull requests' }).waitFor();
    await page.keyboard.press('g');
    await page.keyboard.press('v');
  }

  await page.goto('/');
  await openViews();
  await page.getByRole('button', { name: /Show view cards/ }).click();
  const options = page.getByRole('listbox', { name: 'Saved work item views' }).getByRole('option');
  const order = () => options.evaluateAll((items) => items.map((item) => item.querySelector('[title="Alpha"], [title="Bravo"], [title="Charlie"]')?.textContent));
  const alpha = options.filter({ hasText: 'Alpha' });
  const bravo = options.filter({ hasText: 'Bravo' });
  const charlie = options.filter({ hasText: 'Charlie' });
  await charlie.dragTo(alpha);
  await expect.poll(order).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await expect(alpha).toHaveAttribute('aria-selected', 'true');

  await alpha.focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(alpha.getByText('Shift+←/→/↑/↓')).toBeVisible();
  await expect.poll(order).toEqual(['Alpha', 'Charlie', 'Bravo']);
  await expect(alpha).toBeFocused();

  await page.getByRole('button', { name: 'Compact view list' }).click();
  await bravo.dragTo(charlie);
  await expect.poll(order).toEqual(['Alpha', 'Bravo', 'Charlie']);
  await charlie.dragTo(alpha);
  await expect.poll(order).toEqual(['Charlie', 'Alpha', 'Bravo']);

  await page.reload();
  await openViews();
  await expect.poll(order).toEqual(['Charlie', 'Alpha', 'Bravo']);
  await page.getByRole('button', { name: /Collapse to one row of chips/ }).click();
  await expect.poll(order).toEqual(['Charlie', 'Alpha', 'Bravo']);
});
