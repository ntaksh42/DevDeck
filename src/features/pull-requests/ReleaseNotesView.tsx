import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardCopy, FileText, Loader2 } from "lucide-react";
import {
  commandErrorMessage,
  generateReleaseNotes,
  listWorkItemProjects,
  type Organization,
} from "@/lib/azdoCommands";
import { ErrorState } from "@/components/StateDisplay";
import { generateReleaseNotesMarkdown } from "./releaseNotes";

export function ReleaseNotesView({ organizations }: { organizations: Organization[] }) {
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const selectedOrganizationId = organizationId || organizations[0]?.id || "";
  const [projectId, setProjectId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!organizationId && organizations[0]) setOrganizationId(organizations[0].id);
  }, [organizationId, organizations]);

  const projectsQuery = useQuery({
    queryKey: ["releaseNotesProjects", selectedOrganizationId],
    queryFn: () => listWorkItemProjects({ organizationId: selectedOrganizationId }),
    enabled: !!selectedOrganizationId,
    staleTime: 5 * 60_000,
  });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const mutation = useMutation({
    mutationFn: generateReleaseNotes,
    onSuccess: (prs) => {
      setMarkdown(generateReleaseNotesMarkdown(prs, { fromDate, toDate }));
      setCopied(false);
    },
  });

  function onGenerate() {
    if (!projectId) return;
    mutation.mutate({
      organizationId: selectedOrganizationId,
      projectId,
      fromDate: fromDate || undefined,
      toDate: toDate || undefined,
    });
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end gap-3 rounded-md border border-border bg-card p-3">
        {organizations.length > 1 && (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">Organization</span>
            <select
              value={selectedOrganizationId}
              onChange={(e) => {
                setOrganizationId(e.target.value);
                setProjectId("");
              }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">Project</span>
          <select
            value={projectId}
            disabled={projectsQuery.isLoading}
            onChange={(e) => setProjectId(e.target.value)}
            className="h-9 min-w-[180px] rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          >
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.projectName}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!projectId || mutation.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="h-4 w-4" aria-hidden="true" />
          )}
          Generate
        </button>
      </div>

      {mutation.isError ? <ErrorState message={commandErrorMessage(mutation.error)} /> : null}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Markdown</span>
          <button
            type="button"
            onClick={onCopy}
            disabled={!markdown}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-secondary disabled:opacity-50"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden="true" />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <textarea
          readOnly
          value={markdown}
          aria-label="Generated release notes"
          placeholder="Select a project and date range, then Generate."
          className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs outline-none"
        />
      </div>
    </div>
  );
}
