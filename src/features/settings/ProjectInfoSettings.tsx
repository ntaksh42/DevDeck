import { type ReactNode, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  listPipelineProjects,
  listProjectTeams,
  listServiceConnections,
  listServiceHooks,
} from "@/lib/azdoCommands";
import { useActiveOrganizationId } from "@/lib/useActiveConnection";

// Read-only look at one project's teams, service connections and service hooks
// (issue #541). Nothing is editable here; configuration stays in Azure DevOps.
// Each section loads only when it is opened, so unused ones cost no requests.
export function ProjectInfoSettings() {
  const organizationId = useActiveOrganizationId();
  const projects = useQuery({
    queryKey: ["projectInfoProjects", organizationId],
    queryFn: () => listPipelineProjects({ organizationId }),
    enabled: organizationId !== "",
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [selectedId, setSelectedId] = useState("");
  const projectList = projects.data ?? [];
  const projectId = projectList.some((project) => project.id === selectedId)
    ? selectedId
    : (projectList[0]?.id ?? "");

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-base font-semibold">Project info</h2>
        <p className="text-sm text-muted-foreground">
          Read-only view of a project&apos;s teams, service connections and service hooks. Edit
          them in Azure DevOps.
        </p>
      </div>
      <div className="grid gap-2 p-3 text-sm">
        {projects.isError ? (
          <p role="alert" className="text-destructive">
            {commandErrorMessage(projects.error)}
          </p>
        ) : projectList.length === 0 ? (
          <p className="text-muted-foreground">
            {projects.isPending && organizationId !== "" ? "Loading projects…" : "No projects."}
          </p>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Project</span>
              <select
                value={projectId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
              >
                {projectList.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <Section title="Teams" key={`teams:${projectId}`}>
              <TeamsList organizationId={organizationId} projectId={projectId} />
            </Section>
            <Section title="Service connections" key={`connections:${projectId}`}>
              <ConnectionsList organizationId={organizationId} projectId={projectId} />
            </Section>
            <Section title="Service hooks" key={`hooks:${projectId}`}>
              <HooksList organizationId={organizationId} projectId={projectId} />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

// A native <details> is keyboard-operable (Enter/Space on the summary) for free;
// children mount only once it has been opened.
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
      className="rounded-md border border-border"
    >
      <summary className="cursor-pointer px-3 py-1.5 font-medium focus:outline-none focus:ring-2 focus:ring-ring">
        {title}
      </summary>
      <div className="border-t border-border px-3 py-2">{opened ? children : null}</div>
    </details>
  );
}

function QueryStatus({
  isPending,
  error,
  empty,
  emptyText,
}: {
  isPending: boolean;
  error: unknown;
  empty: boolean;
  emptyText: string;
}) {
  if (isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (error) {
    return (
      <p role="alert" className="text-destructive">
        {commandErrorMessage(error)}
      </p>
    );
  }
  return empty ? <p className="text-muted-foreground">{emptyText}</p> : null;
}

const BADGE = "rounded border border-border px-1 text-[10px] text-muted-foreground";

function TeamsList({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const query = useQuery({
    queryKey: ["projectTeams", organizationId, projectId],
    queryFn: () => listProjectTeams({ organizationId, projectId }),
    staleTime: 60_000,
    retry: false,
  });
  const teams = query.data?.teams ?? [];
  return (
    <div className="grid gap-2">
      <QueryStatus
        isPending={query.isPending}
        error={query.error}
        empty={!query.isPending && !query.error && teams.length === 0}
        emptyText="No teams."
      />
      {teams.map((team) => (
        <div key={team.id}>
          <div className="font-medium">
            {team.name}{" "}
            <span className="font-normal text-muted-foreground">
              ({team.members.length} {team.members.length === 1 ? "member" : "members"})
            </span>
          </div>
          {team.description ? (
            <div className="text-xs text-muted-foreground">{team.description}</div>
          ) : null}
          <ul className="mt-0.5 text-xs">
            {team.members.map((member) => (
              <li key={`${member.uniqueName ?? member.displayName}`}>
                {member.displayName}
                {member.uniqueName && member.uniqueName !== member.displayName ? (
                  <span className="text-muted-foreground"> · {member.uniqueName}</span>
                ) : null}
                {member.isTeamAdmin ? <span className={`ml-1 ${BADGE}`}>admin</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {query.data?.truncated ? (
        <p className="text-xs text-muted-foreground">
          Only the first teams are shown; this project has more.
        </p>
      ) : null}
    </div>
  );
}

function ConnectionsList({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const query = useQuery({
    queryKey: ["serviceConnections", organizationId, projectId],
    queryFn: () => listServiceConnections({ organizationId, projectId }),
    staleTime: 60_000,
    retry: false,
  });
  const connections = query.data ?? [];
  return (
    <div className="grid gap-1.5">
      <QueryStatus
        isPending={query.isPending}
        error={query.error}
        empty={!query.isPending && !query.error && connections.length === 0}
        emptyText="No service connections."
      />
      {connections.map((connection) => (
        <div key={connection.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{connection.name}</div>
            <div className="text-xs text-muted-foreground">
              {[connection.endpointType, connection.description].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <span className={BADGE}>{connection.isReady ? "Ready" : "Not ready"}</span>
            {connection.isShared ? <span className={BADGE}>Shared</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function HooksList({ organizationId, projectId }: { organizationId: string; projectId: string }) {
  const query = useQuery({
    queryKey: ["serviceHooks", organizationId, projectId],
    queryFn: () => listServiceHooks({ organizationId, projectId }),
    staleTime: 60_000,
    retry: false,
  });
  const hooks = query.data ?? [];
  return (
    <div className="grid gap-1.5">
      <QueryStatus
        isPending={query.isPending}
        error={query.error}
        empty={!query.isPending && !query.error && hooks.length === 0}
        emptyText="No service hook subscriptions."
      />
      {hooks.map((hook) => (
        <div key={hook.id} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{hook.eventType ?? "(any event)"}</div>
            <div className="text-xs text-muted-foreground">
              {[hook.consumer, hook.consumerAction].filter(Boolean).join(" · ")}
            </div>
          </div>
          {hook.status ? <span className={`shrink-0 ${BADGE}`}>{hook.status}</span> : null}
        </div>
      ))}
    </div>
  );
}
