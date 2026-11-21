import { expect, it, vi } from "vitest";
import responses from "../../../tests/fixtures/ipc-responses.json";
import { listAgentWork } from "./agentWork";
import { getHomeBot, getHomeChat } from "./homeBot";
import { getAppSettings } from "./orgs";
import { listPipelineRuns } from "./pipelines";
import { listMyCreatedPullRequests } from "./prs";
import { invokeCommand } from "./runtime";
import { getCachedWorkItemQuery, runWorkItemQuery } from "./workItems";

vi.mock("./runtime", () => ({ invokeCommand: vi.fn() }));
const project = { organizationId: "fixture-org", projectId: "fixture-project" };

const commands = {
  get_app_settings: getAppSettings,
  list_my_created_pull_requests: () => listMyCreatedPullRequests({ organizationId: project.organizationId }),
  get_cached_work_item_query: () => getCachedWorkItemQuery({ ...project, wiql: "SELECT [System.Id] FROM WorkItems" }),
  run_work_item_query: () => runWorkItemQuery({ ...project, wiql: "SELECT [System.Id] FROM WorkItemLinks" }),
  list_pipeline_runs: () => listPipelineRuns(project),
  list_agent_work: listAgentWork,
  get_home_bot: getHomeBot,
  get_home_chat: getHomeChat,
} satisfies Record<keyof typeof responses, () => Promise<unknown>>;

it.each(Object.keys(commands) as (keyof typeof commands)[])(
  "%s preserves its Rust response through the frontend parser",
  async (command) => {
    vi.mocked(invokeCommand).mockImplementation(async (name) => {
      expect(name).toBe(command);
      return responses[command];
    });
    await expect(commands[command]()).resolves.toEqual(responses[command]);
  },
);
