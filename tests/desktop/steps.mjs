import assert from 'node:assert/strict';
import { desktopHarness } from './harness.mjs';

export async function withConnectedDesktop(t, run) {
  const app = await desktopHarness(t);
  const { browser, org } = app;
  try {
    const organization = browser.$('input[placeholder="contoso"]');
    await organization.waitForDisplayed();
    assert.equal(await browser.execute(() => Boolean(window.__TAURI_INTERNALS__)), true);
    await organization.setValue(org);
    await browser.keys('Tab');
    await browser.keys('fake-e2e-token');
    await browser.keys('Enter');
    await browser.$('button[data-nav-label="My Reviews"]').waitForDisplayed();
    await run(app);
  } catch (error) {
    app.fail();
    throw error;
  }
}

export async function openReviewGrid(browser) {
  const reviews = browser.$('button[data-nav-label="My Reviews"]');
  await reviews.waitForDisplayed();
  await reviews.click();
  await browser.keys(['Control', 'e']);
  return await waitForGridText(browser, 'My review pull requests', 'Retry policy for the gateway client');
}

export async function waitForGridText(browser, label, text) {
  const grid = browser.$(`[role="grid"][aria-label="${label}"]`);
  await grid.waitForDisplayed();
  await browser.waitUntil(async () => (await grid.getText()).includes(text), {
    timeout: 60_000, timeoutMsg: `${label} did not display ${text} from the real backend`,
  });
  return grid;
}
