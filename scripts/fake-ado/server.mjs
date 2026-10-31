// A fake Azure DevOps REST server for trying DevDeck's desktop app with
// scenario data. It answers the requests the background sync and the Inbox
// make; anything else gets an empty list so the app keeps working, and is
// logged so missing routes are easy to spot.
//
// Control routes (not part of Azure DevOps):
//   POST /_fake/next   move the scenario to its next stage
//   GET  /_fake/state  the current stage

import http from "node:http";

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const withoutThreads = ({ threads, ...pr }) => pr;
const withoutComments = ({ comments, ...item }) => item;

/**
 * Starts the server for `scenario` (a module exporting createState / advance /
 * wiqlIds / ME / TEAM / PROJECT / REPO). Resolves with the http.Server.
 */
export function startFakeAdo({ scenario, org, port, options, log = console.log }) {
  const state = scenario.createState(options);
  const { ME, TEAM, PROJECT, REPO } = scenario;
  let commentSeq = 900_000;

  const routes = [
    ["GET", /^\/_apis\/connectiondata$/, () => ({
      authenticatedUser: {
        id: ME.id,
        providerDisplayName: ME.displayName,
        descriptor: "aad.fake-me",
        properties: { Account: { $value: ME.uniqueName } },
      },
    })],
    ["GET", /^\/_apis\/projects$/, () => ({ count: 1, value: [PROJECT] })],
    ["GET", /^\/_apis\/identities$/, (_m, url) => {
      if (url.searchParams.get("identityIds")) {
        return { count: 1, value: [{ id: ME.id, displayName: ME.displayName, memberOf: [TEAM.descriptor] }] };
      }
      if (url.searchParams.get("descriptors")) {
        return { count: 1, value: [{ id: TEAM.id, displayName: TEAM.displayName, descriptor: TEAM.descriptor }] };
      }
      return { count: 0, value: [] };
    }],
    ["GET", /^\/[^/]+\/_apis\/git\/repositories$/, () => ({ count: 1, value: [REPO] })],
    ["GET", /^\/[^/]+\/_apis\/git\/(?:repositories\/[^/]+\/)?pullrequests$/, (_m, url) => {
      const reviewer = url.searchParams.get("searchCriteria.reviewerId");
      const creator = url.searchParams.get("searchCriteria.creatorId");
      const status = url.searchParams.get("searchCriteria.status") ?? "active";
      const value = state.prs
        .filter((pr) => status === "all" || pr.status === status)
        .filter((pr) => !reviewer || pr.reviewers.some((r) => r.id === reviewer))
        .filter((pr) => !creator || pr.createdBy.id === creator)
        .map(withoutThreads);
      return { count: value.length, value };
    }],
    ["GET", /^\/[^/]+\/_apis\/git\/repositories\/[^/]+\/pullrequests\/(\d+)$/, (m) => {
      const pr = state.prs.find((p) => p.pullRequestId === Number(m[1]));
      return pr ? withoutThreads(pr) : null;
    }],
    ["GET", /^\/[^/]+\/_apis\/git\/repositories\/[^/]+\/pullrequests\/(\d+)\/threads$/, (m) => {
      const pr = state.prs.find((p) => p.pullRequestId === Number(m[1]));
      return { count: pr?.threads.length ?? 0, value: pr?.threads ?? [] };
    }],
    ["POST", /^\/[^/]+\/_apis\/git\/repositories\/[^/]+\/pullrequests\/(\d+)\/threads\/(\d+)\/comments$/, (m, _url, body) => {
      const thread = state.prs.find((p) => p.pullRequestId === Number(m[1]))?.threads.find((t) => t.id === Number(m[2]));
      if (!thread) return null;
      commentSeq += 1;
      const added = {
        id: commentSeq,
        parentCommentId: body.parentCommentId ?? 0,
        content: body.content ?? "",
        commentType: "text",
        author: ME,
        publishedDate: new Date().toISOString(),
        isDeleted: false,
      };
      thread.comments.push(added);
      return added;
    }],
    ["PATCH", /^\/[^/]+\/_apis\/git\/repositories\/[^/]+\/pullrequests\/(\d+)\/threads\/(\d+)$/, (m, _url, body) => {
      const thread = state.prs.find((p) => p.pullRequestId === Number(m[1]))?.threads.find((t) => t.id === Number(m[2]));
      if (!thread) return null;
      if (body.status) thread.status = body.status;
      return thread;
    }],
    ["POST", /^(?:\/[^/]+)?\/_apis\/wit\/wiql$/, (_m, _url, body) => {
      const result = scenario.wiqlIds(state, body.query ?? "");
      if (result.error) return { status: 400, body: { message: result.error, typeKey: "WorkItemTrackingQueryException" } };
      return { workItems: result.ids.map((id) => ({ id })) };
    }],
    ["POST", /^(?:\/[^/]+)?\/_apis\/wit\/workitemsbatch$/, (_m, _url, body) => {
      const ids = new Set(body.ids ?? []);
      const value = state.workItems.filter((w) => ids.has(w.id)).map(withoutComments);
      return { count: value.length, value };
    }],
    ["GET", /^\/[^/]+\/_apis\/wit\/workitems\/(\d+)$/, (m) => {
      const item = state.workItems.find((w) => w.id === Number(m[1]));
      return item ? withoutComments(item) : null;
    }],
    ["GET", /^\/[^/]+\/_apis\/wit\/workitems\/(\d+)\/comments$/, (m) => {
      const comments = state.workItems.find((w) => w.id === Number(m[1]))?.comments ?? [];
      // Azure DevOps lists comments newest first.
      const ordered = [...comments].sort((a, b) => b.id - a.id);
      return { totalCount: ordered.length, count: ordered.length, comments: ordered };
    }],
    ["POST", /^\/[^/]+\/_apis\/wit\/workitems\/(\d+)\/comments$/, (m, _url, body) => {
      const item = state.workItems.find((w) => w.id === Number(m[1]));
      if (!item) return null;
      commentSeq += 1;
      const added = { id: commentSeq, text: body.text ?? "", renderedText: body.text ?? "", createdDate: new Date().toISOString(), createdBy: ME, reactions: [] };
      item.comments.push(added);
      item.fields["System.ChangedDate"] = added.createdDate;
      return added;
    }],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/_fake/next" && req.method === "POST") {
      const step = scenario.advance(state);
      log(step ? `[fake-ado] ${step}` : "[fake-ado] already at the last stage");
      return json(res, 200, { stage: state.stage, changed: step });
    }
    if (url.pathname === "/_fake/state") return json(res, 200, { stage: state.stage });

    const prefix = `/${org.toLowerCase()}`;
    const lower = url.pathname.toLowerCase().replace(/\/+$/, "");
    if (!lower.startsWith(prefix)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<p>DevDeck fake Azure DevOps (${req.method} ${url.pathname})</p>`);
    }
    // Paths are matched in lower case: Azure DevOps routes are case-insensitive
    // and the client mixes `pullRequests` / `pullrequests`, `workItems` / `workitems`.
    const path = lower.slice(prefix.length) || "/";
    const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readBody(req) : {};
    for (const [method, pattern, handler] of routes) {
      const match = method === req.method && path.match(pattern);
      if (!match) continue;
      const result = handler(match, url, body);
      if (result === null) return json(res, 404, { message: `not found: ${url.pathname}` });
      if (result?.status && result?.body) return json(res, result.status, result.body);
      return json(res, 200, result);
    }
    log(`[fake-ado] unhandled ${req.method} ${url.pathname}${url.search} -> empty list`);
    return json(res, 200, { count: 0, value: [] });
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
