import { expect, test } from '@playwright/test';

test('reorders watched pipelines in Manual mode and restores that order after reload', async ({ page }) => {
  async function openPipelines() {
    await page.getByRole('grid', { name: 'My review pull requests' }).waitFor();
    await page.keyboard.press('g');
    await page.keyboard.press('p');
  }

  await page.goto('/');
  await openPipelines();
  const sort = page.getByRole('combobox', { name: 'Sort pipelines' });
  const rows = page.locator('[data-board-header]');
  const ci = rows.filter({ hasText: 'CI' });
  const nightly = rows.filter({ hasText: 'Nightly' });
  await expect(sort).toHaveValue('status');
  await expect(sort.locator('option[value="manual"]')).toHaveText('Sort: Manual (reorder)');
  await expect(ci).not.toHaveAttribute('draggable', 'true');
  await sort.selectOption('manual');
  await expect(rows).toHaveText([/CI/, /Nightly/]);
  await nightly.dragTo(ci);
  await expect(rows).toHaveText([/Nightly/, /CI/]);
  await expect(nightly).toHaveAttribute('aria-expanded', 'false');
  await sort.selectOption('name');
  await expect(rows).toHaveText([/CI/, /Nightly/]);
  await sort.selectOption('manual');
  await expect(rows).toHaveText([/Nightly/, /CI/]);

  await nightly.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(nightly.getByText('Alt+↑/↓')).toBeVisible();
  await expect(rows).toHaveText([/CI/, /Nightly/]);
  await expect(nightly).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(rows).toHaveText([/Nightly/, /CI/]);
  await page.reload();
  await openPipelines();
  await expect(sort).toHaveValue('manual');
  await expect(rows).toHaveText([/Nightly/, /CI/]);
});
