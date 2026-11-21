import { expect, test } from '@playwright/test';

test('reorders review groups by drag and keyboard and remembers each grouping', async ({ page }) => {
  await page.goto('/');
  const grid = page.getByRole('grid', { name: 'My review pull requests' });
  const handles = grid.getByRole('button', { name: /^Reorder group / });
  const order = () => handles.evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
  const groupBy = page.getByRole('combobox', { name: 'Group reviews by' });
  await expect(handles.nth(1)).toBeVisible();
  const statusOrder = await order();
  const [firstStatus, secondStatus, ...otherStatuses] = statusOrder;
  await handles.nth(1).dragTo(handles.nth(0));
  const reorderedStatus = [secondStatus, firstStatus, ...otherStatuses];
  await expect.poll(order).toEqual(reorderedStatus);

  await groupBy.selectOption('repository');
  await expect(handles.nth(1)).toBeVisible();
  const [firstRepo, secondRepo, ...otherRepos] = await order();
  const handle = grid.getByRole('button', { name: secondRepo!, exact: true });
  await handle.focus();
  await page.keyboard.press('Alt+ArrowUp');
  const reorderedRepos = [secondRepo, firstRepo, ...otherRepos];
  await expect.poll(order).toEqual(reorderedRepos);
  await expect(handle).toBeFocused();

  await page.reload();
  await expect(groupBy).toHaveValue('repository');
  await expect.poll(order).toEqual(reorderedRepos);
  await groupBy.selectOption('status');
  await expect.poll(order).toEqual(reorderedStatus);
});
