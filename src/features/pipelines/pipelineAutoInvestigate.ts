import { buildContextDocument } from "@/components/agent/contextDocument";
import { contextLine } from "@/components/agent/agentSubject";
import { newAskId } from "@/components/agent/useAgentPanelData";
import {
  createAgentNote,
  listFlakyTests,
  listPipelineTestResults,
  runAgent,
  type PipelineRunSummary,
} from "@/lib/azdoCommands";
import { flakyBadge, flakyHint, flakyStatsByName } from "./flakyTestPresentation";
import { pipelineRunSubject } from "./pipelineAgent";

// Automatic investigation of failed watched pipelines (setting
// `autoAgentPipelinesEnabled`): when a watched pipeline's latest run finishes
// as failed, the default agent gets an `investigate` request (an Agent panel
// "ask") with the run's material and the failed tests compared with recent
// runs. The agent's reply raises the usual "Agent replied" notification.

const STORAGE_KEY = "azdodeck:pipelines:autoInvestigated";
/** Investigations started per rolling hour, across all watched pipelines. */
export const AUTO_INVESTIGATIONS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
/** Runs remembered as investigated (so a restart does not start them again). */
const REMEMBERED = 200;
const KEEP_MS = 14 * 24 * HOUR_MS;
/** Same cap as the Agent panel's material, plus room for the failed tests. */
const MAX_DOCUMENT_CHARS = 400_000;
const MAX_TESTS_CHARS = 40_000;

type Claim = { key: string; at: number };

function loadClaims(): Claim[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is Claim =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as Claim).key === "string" &&
        typeof (entry as Claim).at === "number",
    );
  } catch {
    return [];
  }
}

function saveClaims(claims: Claim[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(claims));
  } catch {
    // Storage unavailable: the in-memory rate limit of this session still applies.
  }
}

export function investigationKey(run: Pick<PipelineRunSummary, "organizationId" | "projectId" | "buildId">): string {
  return `${run.organizationId}/${run.projectId}/${run.buildId}`;
}

/**
 * Records that `key` is being investigated, unless it already was or the
 * hourly limit is reached. Returns whether the caller may start it.
 */
export function claimInvestigation(key: string, now = Date.now()): boolean {
  const claims = loadClaims().filter((claim) => now - claim.at < KEEP_MS);
  if (claims.some((claim) => claim.key === key)) return false;
  if (claims.filter((claim) => now - claim.at < HOUR_MS).length >= AUTO_INVESTIGATIONS_PER_HOUR) {
    return false;
  }
  saveClaims([...claims, { key, at: now }].slice(-REMEMBERED));
  return true;
}

/** A finished run worth investigating: it failed (not canceled, not partially succeeded). */
export function isInvestigableFailure(
  transition: "started" | "finished" | null,
  run: Pick<PipelineRunSummary, "result">,
): boolean {
  return transition === "finished" && run.result?.toLowerCase() === "failed";
}

export const INVESTIGATION_REQUEST = [
  "Investigate why this pipeline run failed. The context file has the run's timeline, the tail of the failed logs, and its failed tests compared with the pipeline's recent runs.",
  "",
  "Start your answer with one line `Verdict: flaky | code | infra | unknown`:",
  "- flaky: the failures are known flaky tests or a transient error; retrying the failed jobs is enough.",
  "- code: a change broke it; name the failing step, the error, and the likely commit or files.",
  "- infra: the build agent, environment, a service connection or an external service failed.",
  "- unknown: the material is not enough; say what to look at next.",
  "",
  "Then explain in a few short points, quoting the log lines or test errors that show it. Do not change code, do not re-run the pipeline, and do not propose comments.",
].join("\n");

/** Markdown about the run's failed tests and how they behaved in recent runs; empty when none failed. */
export async function failedTestsSection(run: PipelineRunSummary): Promise<string> {
  const input = { organizationId: run.organizationId, projectId: run.projectId };
  let results;
  try {
    results = await listPipelineTestResults({ ...input, buildId: run.buildId });
  } catch {
    return "";
  }
  if (results.failedTests.length === 0) return "";
  const report =
    run.definitionId == null
      ? null
      : await listFlakyTests({
          ...input,
          definitionId: run.definitionId,
          branch: run.sourceBranch ?? undefined,
        }).catch(() => null);
  const stats = flakyStatsByName(report ?? undefined);
  const lines = results.failedTests.map((test) => {
    const stat = stats.get(test.name);
    const history = stat ? `${flakyBadge(stat).label}: ${flakyBadge(stat).explanation}` : "no history";
    const error = test.errorMessage?.split("\n")[0]?.slice(0, 300);
    return `- ${test.name} — ${history}${error ? `\n  - Error: ${error}` : ""}`;
  });
  const hint = flakyHint(
    results.failedTests.map((test) => test.name),
    stats,
    results.truncated,
  );
  return [
    "## Failed tests compared with recent runs",
    report
      ? `Compared with the last ${report.comparedRuns} completed runs on the same branch.`
      : "The comparison with recent runs is unavailable.",
    hint,
    lines.join("\n"),
    results.truncated ? `(${results.failed} tests failed; the first ${results.failedTests.length} are listed.)` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Creates the request and starts the default agent on it. */
export async function startPipelineInvestigation(run: PipelineRunSummary): Promise<void> {
  const subject = pipelineRunSubject(run, run.organizationId, run.projectId);
  const material = await buildContextDocument(subject);
  const tests = await failedTestsSection(run);
  const item = { target: "ask" as const, itemId: newAskId() };
  await createAgentNote({
    ...item,
    body: INVESTIGATION_REQUEST,
    kind: "investigate",
    context: contextLine(subject),
    contextDocument: [material, tests.slice(0, MAX_TESTS_CHARS)]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, MAX_DOCUMENT_CHARS),
  });
  await runAgent(item);
}

// Requests are started one at a time, a second apart, because a request's id
// is its creation time in seconds.
let queue: Promise<void> = Promise.resolve();

export function enqueuePipelineInvestigation(
  run: PipelineRunSummary,
  onStarted: () => void,
  start: (run: PipelineRunSummary) => Promise<void> = startPipelineInvestigation,
): Promise<void> {
  queue = queue
    .then(async () => {
      await start(run);
      onStarted();
      await new Promise((resolve) => setTimeout(resolve, 1100));
    })
    .catch((error) => console.error("Failed to start the pipeline investigation", error));
  return queue;
}
