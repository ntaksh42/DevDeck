import assert from 'node:assert/strict';
import test from 'node:test';
import { startFakeAdo } from './server.mjs';
import * as scenario from './scenarios/inbox.mjs';

test('review PR pagination ends after the matching PR instead of repeating it', async (t) => {
  const server = await startFakeAdo({ scenario, org: 'pagination-test', port: 0, options: {} });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = new URL(`http://127.0.0.1:${server.address().port}/pagination-test/p-platform/_apis/git/pullrequests`);
  url.searchParams.set('searchCriteria.reviewerId', scenario.ME.id);
  url.searchParams.set('$top', '200');
  const first = await (await fetch(url)).json();
  assert.deepEqual(first.value.map((pr) => pr.pullRequestId), [101]);
  url.searchParams.set('$skip', String(first.value.length));
  assert.deepEqual(await (await fetch(url)).json(), { count: 0, value: [] });
});

test('new PR threads persist their comment, author and file context for later retrieval', async (t) => {
  const server = await startFakeAdo({ scenario, org: 'comments-test', port: 0, options: {} });
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/comments-test/p-platform/_apis/git/repositories/r-api/pullrequests/101/threads`;
  const context = { filePath: '/src/retry.ts', rightFileStart: { line: 12, offset: 1 } };
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 1, threadContext: context, comments: [{ content: 'A persisted review comment', commentType: 1 }] }),
  });
  assert.equal(response.status, 200);
  const created = await response.json();
  assert.equal(created.status, 'active');
  assert.equal(created.comments[0].commentType, 'text');
  assert.equal(created.comments[0].content, 'A persisted review comment');
  assert.equal(created.comments[0].author.id, scenario.ME.id);
  assert.deepEqual(created.threadContext, context);
  const retrieved = await (await fetch(url)).json();
  assert.deepEqual(retrieved.value.find((thread) => thread.id === created.id), created);
  assert.equal(new Set(retrieved.value.map((thread) => thread.id)).size, retrieved.count);
  assert.equal((await fetch(url.replace('/101/', '/999/'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  })).status, 404);
});
