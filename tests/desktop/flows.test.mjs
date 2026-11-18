import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withConnectedDesktop, openReviewGrid, waitForGridText } from './steps.mjs';

test('desktop: My Pull Requests shows authored PRs and excludes review-only PRs', { timeout: 120_000 }, async (t) => {
  await withConnectedDesktop(t, async ({ browser, artifacts }) => {
    await browser.$('button[data-nav-label="My Pull Requests"]').click();
    await browser.keys(['Control', 'e']);
    const grid = await waitForGridText(browser, 'My pull requests', 'Add health endpoint');
    const text = await grid.getText();
    assert.match(text, /#102/);
    assert.doesNotMatch(text, /Retry policy for the gateway client/);
    await browser.saveScreenshot(`${artifacts}/my-pull-requests.png`);
  });
});

test('desktop: assigned Work Items shows the current user item and its preview', { timeout: 120_000 }, async (t) => {
  await withConnectedDesktop(t, async ({ browser, artifacts }) => {
    await browser.$('button[data-nav-label="Assigned to me"]').click();
    await browser.keys(['Control', 'e']);
    const grid = await waitForGridText(browser, 'Work items', 'Gateway timeout investigation');
    assert.doesNotMatch(await grid.getText(), /Document the retry policy/);
    await grid.$('[role="row"]').click();
    await browser.keys('Enter');
    const title = browser.$('button[aria-label="Edit title"]');
    await title.waitForDisplayed();
    assert.match(await title.getText(), /Gateway timeout investigation/);
    await browser.saveScreenshot(`${artifacts}/work-items.png`);
  });
});

test('desktop: post a new PR comment with Ctrl+Enter and retrieve it after reload', { timeout: 120_000 }, async (t) => {
  await withConnectedDesktop(t, async ({ browser, org, artifacts }) => {
    const grid = await openReviewGrid(browser);
    await grid.$('[role="row"]').click();
    const composer = browser.$('[data-pr-comment-composer="true"]');
    await composer.$('button').waitForDisplayed();
    await composer.$('button').click();
    const comment = `Desktop E2E persisted comment ${org}`;
    await composer.$('textarea').setValue(comment);
    await browser.keys(['Control', 'Enter']);
    const preview = browser.$('[data-primary-preview="true"]');
    await browser.waitUntil(async () => (await preview.getText()).includes(comment), {
      timeoutMsg: 'Posted PR comment was not shown',
    });
    // Reload destroys React Query's in-memory result: the comment must come from REST again.
    const beforeReload = readFileSync(`${artifacts}/driver.log`, 'utf8').length;
    await browser.refresh();
    const reloadedGrid = await openReviewGrid(browser);
    await reloadedGrid.$('[role="row"]').click();
    await browser.waitUntil(async () => (await browser.$('[data-primary-preview="true"]').getText()).includes(comment), {
      timeoutMsg: 'Posted PR comment did not survive a full page reload',
    });
    const requests = readFileSync(`${artifacts}/driver.log`, 'utf8').toLowerCase();
    const route = `/${org}/p-platform/_apis/git/repositories/r-api/pullrequests/101/threads`;
    const posted = requests.indexOf(`post ${route}?`);
    assert.ok(posted >= 0, 'Comment creation must reach the fake REST server');
    assert.ok(requests.slice(beforeReload).includes(`get ${route}?`), 'Threads must be fetched again after reload');
    await browser.$(`p=${comment}`).scrollIntoView({ block: 'center' });
    await browser.saveScreenshot(`${artifacts}/pr-comment-reloaded.png`);
  });
});
