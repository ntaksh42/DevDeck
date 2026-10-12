import {
  commandErrorMessage,
  getPipelineRun,
  getPipelineRunLogTail,
  getPullRequestReview,
  getWikiPage,
  getWorkItemPreview,
  listPullRequestChanges,
} from "@/lib/azdoCommands";
import type { AgentSubject } from "./agentSubject";

// The agent runs without Azure DevOps access, so DevDeck gathers what it may
// need about the subject and hands it over as one Markdown document saved
// beside the note (`_context/`).

const MAX_LOGS = 3;
const LOG_LINES = 150;
const MAX_CHARS = 400_000;

function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

function fields(rows: [string, string | null | undefined][]): string {
  return rows
    .filter(([, value]) => value)
    .map(([name, value]) => `- ${name}: ${value}`)
    .join("\n");
}

async function pullRequest(subject: Extract<AgentSubject, { kind: "pull-request" }>): Promise<string> {
  const locator = {
    organizationId: subject.organizationId,
    projectId: subject.projectId,
    repositoryId: subject.repositoryId,
    pullRequestId: subject.id,
  };
  const [review, changes] = await Promise.all([
    getPullRequestReview(locator),
    listPullRequestChanges(locator).catch(() => null),
  ]);
  const threads = review.threads
    .filter((thread) => thread.comments.some((c) => !c.isSystem && c.content))
    .map((thread) => {
      const where = thread.filePath ? ` (${thread.filePath}${thread.rightLine ? `:${thread.rightLine}` : ""})` : "";
      const status = thread.isResolved ? "resolved" : (thread.status ?? "active");
      const comments = thread.comments
        .filter((c) => !c.isSystem && c.content)
        .map((c) => `  - ${c.author ?? "?"}: ${c.content}`)
        .join("\n");
      return `- Thread ${thread.id} [${status}]${where}\n${comments}`;
    });
  return [
    `# Pull request !${review.pullRequestId}: ${review.title}`,
    fields([
      ["Repository", subject.repositoryName],
      ["Source", review.sourceRefName],
      ["Target", review.targetRefName],
      ["Author", review.createdBy],
      ["Created", review.creationDate],
      ["Draft", review.isDraft ? "yes" : null],
      ["Reviewers", review.reviewers.map((r) => `${r.displayName} (${r.voteLabel})`).join(", ")],
      ["URL", subject.webUrl],
    ]),
    "## Description",
    review.description || "(none)",
    "## Changed files",
    changes ? changes.files.map((f) => `- ${f.changeType} ${f.path}`).join("\n") || "(none)" : "(unavailable)",
    "## Comment threads",
    threads.join("\n") || "(none)",
  ].join("\n\n");
}

async function workItem(subject: Extract<AgentSubject, { kind: "work-item" }>): Promise<string> {
  const item = await getWorkItemPreview({
    organizationId: subject.organizationId,
    projectId: subject.projectId,
    workItemId: subject.id,
  });
  const custom = item.customFields.map((f) => [f.referenceName, f.value] as [string, string | null]);
  return [
    `# Work item #${item.id}: ${item.title}`,
    fields([
      ["Type", item.workItemType],
      ["State", item.state],
      ["Reason", item.reason],
      ["Assigned to", item.assignedTo],
      ["Created by", item.createdBy],
      ["Created", item.createdDate],
      ["Changed", item.changedDate],
      ["Area", item.areaPath],
      ["Iteration", item.iterationPath],
      ["Priority", item.priority],
      ["Severity", item.severity],
      ["Tags", item.tags],
      ...custom,
      ["URL", item.webUrl],
    ]),
    "## Description",
    htmlToText(item.descriptionHtml) || "(none)",
    item.acceptanceCriteriaHtml ? `## Acceptance criteria\n\n${htmlToText(item.acceptanceCriteriaHtml)}` : "",
    "## Linked pull requests",
    item.pullRequests
      .map((pr) => `- !${pr.pullRequestId} ${pr.title ?? ""} [${pr.status ?? ""}] ${pr.webUrl ?? ""}`)
      .join("\n") || "(none)",
    "## Comments (newest first)",
    item.comments
      .map((c) => `- ${c.createdBy ?? "?"} (${c.createdDate ?? ""}):\n\n${htmlToText(c.renderedText ?? c.text)}`)
      .join("\n\n") || "(none)",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function pipelineRun(subject: Extract<AgentSubject, { kind: "pipeline-run" }>): Promise<string> {
  const input = { organizationId: subject.organizationId, projectId: subject.projectId, buildId: subject.id };
  const detail = await getPipelineRun(input);
  const { run } = detail;
  const failed = detail.timeline.filter((node) => node.result === "failed" || node.errorCount > 0);
  const logs = await Promise.all(
    failed
      .filter((node) => node.logId !== null)
      .slice(0, MAX_LOGS)
      .map(async (node) => {
        try {
          const tail = await getPipelineRunLogTail({ ...input, logId: node.logId!, maxLines: LOG_LINES });
          return `### ${node.name ?? node.id} (last ${tail.lines.length} lines)\n\n\`\`\`\n${tail.lines.join("\n")}\n\`\`\``;
        } catch (error) {
          return `### ${node.name ?? node.id}\n\n(log unavailable: ${commandErrorMessage(error)})`;
        }
      }),
  );
  return [
    `# Pipeline run ${run.buildNumber ?? run.buildId}: ${run.definitionName ?? ""}`,
    fields([
      ["Project", run.projectName],
      ["Status", run.status],
      ["Result", run.result],
      ["Branch", run.sourceBranch],
      ["Reason", run.reason],
      ["Requested for", run.requestedFor],
      ["Queued", run.queueTime],
      ["Started", run.startTime],
      ["Finished", run.finishTime],
      ["URL", run.webUrl],
    ]),
    "## Timeline",
    detail.timeline
      .map((n) => `- ${n.nodeType ?? ""} ${n.name ?? n.id}: ${n.result ?? n.state ?? ""}${n.errorCount ? ` (${n.errorCount} errors)` : ""}`)
      .join("\n") || "(unavailable)",
    "## Failed steps",
    logs.join("\n\n") || "(none)",
  ].join("\n\n");
}

async function wikiPage(subject: Extract<AgentSubject, { kind: "wiki-page" }>): Promise<string> {
  const page = await getWikiPage(subject);
  return [`# Wiki page ${page.pagePath}`, `- URL: ${page.webUrl}`, page.content].join("\n\n");
}

/**
 * Markdown describing the subject, for the agent. Failures are written into
 * the document instead of blocking the request.
 */
export async function buildContextDocument(subject: AgentSubject): Promise<string> {
  let text: string;
  try {
    switch (subject.kind) {
      case "pull-request":
        text = await pullRequest(subject);
        break;
      case "work-item":
        text = await workItem(subject);
        break;
      case "pipeline-run":
        text = await pipelineRun(subject);
        break;
      case "wiki-page":
        text = await wikiPage(subject);
        break;
    }
  } catch (error) {
    text = `# ${subject.title}\n\nDevDeck could not gather the details: ${commandErrorMessage(error)}`;
  }
  const header = `<!-- Gathered by DevDeck at ${new Date().toISOString()}. Read-only material for the agent. -->\n\n`;
  return (header + text).slice(0, MAX_CHARS);
}
