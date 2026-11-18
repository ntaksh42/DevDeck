import assert from 'node:assert/strict';
import test from 'node:test';
import { withConnectedDesktop, openReviewGrid } from './steps.mjs';

test('desktop: connect, sync and show a review PR from the fake Azure DevOps server', { timeout: 120_000 }, async (t) => {
  await withConnectedDesktop(t, async (app) => {
    const { browser } = app;
    const grid = await openReviewGrid(browser);
    assert.match(await grid.getText(), /Retry policy for the gateway client/);
    await browser.saveScreenshot(`${app.artifacts}/pr-list.png`);
  });
});
