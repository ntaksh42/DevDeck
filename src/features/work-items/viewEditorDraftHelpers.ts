// Pure helpers for useViewEditorDraft, split out to keep the hook under 500 lines.
import { commandErrorMessage, type WorkItemFieldOption } from '@/lib/azdoCommands';
import { type WiqlCompletion, WIQL_COMPLETIONS, type parseAzdoQueryUrl } from './workItemViewsHelpers';

export type ViewUrlStatus = { text: string; severity: "success" | "error" | "info" } | null;

/** Built-in WIQL completions plus the project's fields that are not already listed. */
export function buildWiqlCompletionPool(fields: WorkItemFieldOption[] | undefined): WiqlCompletion[] {
  const known = new Set(WIQL_COMPLETIONS.map((c) => c.value.toLowerCase()));
  const dynamic = (fields ?? [])
    .filter((field) => !known.has(`[${field.referenceName.toLowerCase()}]`))
    .map((field) => ({
      label: field.referenceName,
      value: `[${field.referenceName}]`,
      detail: field.name,
    }));
  return [...WIQL_COMPLETIONS, ...dynamic];
}

type SavedQueryState = {
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
  data?: { wiql?: string | null } | undefined;
};

/** The status line shown under the "paste a query URL" input. */
export function viewUrlStatus({
  draftUrl,
  urlParsed,
  resolvedProjectId,
  projectsLoading,
  savedQuery,
}: {
  draftUrl: string;
  urlParsed: ReturnType<typeof parseAzdoQueryUrl>;
  resolvedProjectId: string | null;
  projectsLoading: boolean;
  savedQuery: SavedQueryState;
}): ViewUrlStatus {
  if (!draftUrl.trim()) return null;
  const hasAzdoHost =
    draftUrl.includes("dev.azure.com") || draftUrl.includes(".visualstudio.com");
  if (!hasAzdoHost) return { text: "Enter an Azure DevOps URL.", severity: "info" };
  const urlQueryId = urlParsed.queryId ?? null;
  const urlProjectName = urlParsed.projectName ?? null;
  if (urlQueryId) {
    if (urlProjectName && !resolvedProjectId && !projectsLoading) {
      return { text: `Project "${urlProjectName}" not found.`, severity: "error" };
    }
    if (savedQuery.isFetching) return { text: "Fetching WIQL…", severity: "info" };
    if (savedQuery.isError) {
      return {
        text: `Fetch error: ${commandErrorMessage(savedQuery.error)}`,
        severity: "error",
      };
    }
    if (savedQuery.isSuccess && savedQuery.data?.wiql == null) {
      return {
        text: "No WIQL found at this URL (may be a folder or tree query).",
        severity: "error",
      };
    }
    if (savedQuery.isSuccess) return { text: "WIQL fetched.", severity: "success" };
  } else if (urlParsed.orgName ?? urlParsed.projectName) {
    return { text: "Org / Project auto-filled. Enter WIQL manually.", severity: "info" };
  } else {
    return { text: "Azure DevOps query URL not recognized.", severity: "info" };
  }
  return null;
}
