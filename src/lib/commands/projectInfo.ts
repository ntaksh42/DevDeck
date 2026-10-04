import { z } from "zod";
import { invokeCommand } from "./runtime";

const teamMemberSchema = z.object({
  displayName: z.string(),
  uniqueName: z.string().nullable(),
  isTeamAdmin: z.boolean(),
});
const projectTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  members: z.array(teamMemberSchema),
});
const projectTeamsSchema = z.object({
  teams: z.array(projectTeamSchema),
  /** True when the project has more teams than the backend loads members for. */
  truncated: z.boolean(),
});
export type ProjectTeam = z.infer<typeof projectTeamSchema>;
export type ProjectTeams = z.infer<typeof projectTeamsSchema>;

const serviceConnectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  endpointType: z.string().nullable(),
  description: z.string().nullable(),
  isReady: z.boolean(),
  isShared: z.boolean(),
});
export type ServiceConnection = z.infer<typeof serviceConnectionSchema>;

const serviceHookSchema = z.object({
  id: z.string(),
  status: z.string().nullable(),
  publisher: z.string().nullable(),
  eventType: z.string().nullable(),
  consumer: z.string().nullable(),
  consumerAction: z.string().nullable(),
});
export type ServiceHook = z.infer<typeof serviceHookSchema>;

type ProjectInfoInput = { organizationId?: string; projectId: string };

// Read-only project information for Settings (issue #541).
export async function listProjectTeams(input: ProjectInfoInput): Promise<ProjectTeams> {
  const result = await invokeCommand("list_project_teams", { input });
  return projectTeamsSchema.parse(result);
}

export async function listServiceConnections(input: ProjectInfoInput): Promise<ServiceConnection[]> {
  const result = await invokeCommand("list_service_connections", { input });
  return z.array(serviceConnectionSchema).parse(result);
}

export async function listServiceHooks(input: ProjectInfoInput): Promise<ServiceHook[]> {
  const result = await invokeCommand("list_service_hooks", { input });
  return z.array(serviceHookSchema).parse(result);
}
