import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { commandErrorMessage, getRepoFileBinary, type Organization } from "@/lib/azdoCommands";
import { openExternalUrl } from "@/lib/openExternal";
import { ErrorState } from "@/components/StateDisplay";
import { imageMimeType, leafName, webUrl, type RepoOption } from "./codeBrowseShared";

// Inline preview for image files (png/jpg/gif/svg/webp/bmp/ico). Azure DevOps
// file content requires an authenticated request, so this cannot be a plain
// <img src="...">: the bytes are fetched through getRepoFileBinary (the same
// authenticated-fetch pattern used for PR attachment images) and rendered as
// a data URL, which also keeps any SVG markup from being parsed/executed as
// HTML in the page.
export function CodeImagePreview({
  organization,
  organizationId,
  repo,
  branch,
  path,
}: {
  organization: Organization | undefined;
  organizationId: string;
  repo: RepoOption;
  branch: string;
  path: string;
}) {
  const query = useQuery({
    queryKey: ["repoFileBinary", organizationId, repo.repositoryId, branch, path],
    queryFn: () =>
      getRepoFileBinary({
        organizationId,
        project: repo.projectId,
        repository: repo.repositoryId,
        branch,
        path,
      }),
    enabled: !!branch,
    staleTime: 60_000,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
      </div>
    );
  }

  const openInBrowser = (
    <button
      type="button"
      onClick={() => openExternalUrl(webUrl(organization, repo, path, branch))}
      className="text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      Open in Azure DevOps
    </button>
  );

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-3">
        <ErrorState message={commandErrorMessage(query.error)} />
        {openInBrowser}
      </div>
    );
  }

  const file = query.data;
  if (!file || file.tooLarge) {
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-3 text-sm text-muted-foreground">
        <span>Image is too large to preview.</span>
        {openInBrowser}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2 p-3">
      <img
        src={`data:${imageMimeType(path)};base64,${file.contentBase64}`}
        alt={leafName(path)}
        className="max-w-full rounded border border-border"
      />
      {openInBrowser}
    </div>
  );
}
