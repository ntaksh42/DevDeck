import assert from 'node:assert/strict';
import test from 'node:test';
import { desktopHarness } from './harness.mjs';

test('desktop: connect, sync and show a review PR from the fake Azure DevOps server', { timeout: 120_000 }, async (t) => {
  const app = await desktopHarness(t);
  const { browser, org } = app;
  try {
    const organization = browser.$('input[placeholder="contoso"]');
    await organization.waitForDisplayed();
    assert.equal(await browser.execute(() => Boolean(window.__TAURI_INTERNALS__)), true);
    await organization.setValue(org);
    // Tab from the organization field into PAT, then submit with Enter.
    await browser.keys('Tab');
    await browser.keys('fake-e2e-token');
    await browser.keys('Enter');
    const reviews = browser.$('button=My Reviews');
    await reviews.waitForDisplayed();
    await reviews.click();
    await browser.keys(['Control', 'e']);
    const grid = browser.$('[role="grid"][aria-label="My review pull requests"]');
    await grid.waitForDisplayed();
    await browser.waitUntil(async () => (await grid.getText()).includes('Retry policy for the gateway client'), {
      timeout: 60_000, timeoutMsg: 'The real backend did not sync fake PR 101 into My Reviews',
    });
    assert.match(await grid.getText(), /Retry policy for the gateway client/);
    await browser.saveScreenshot(`${app.artifacts}/pr-list.png`);
  } catch (error) {
    app.fail();
    throw error;
  }
});
