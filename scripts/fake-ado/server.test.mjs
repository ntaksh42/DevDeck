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
