import type { PrThread } from "@/lib/azdoCommands";
import { PrCodeSnippet } from "@/features/pull-requests/PrCodeSnippet";
import type { InboxEntry } from "./inboxPresentation";

export { SNIPPET_CONTEXT_LINES, snippetLines } from "@/features/pull-requests/PrCodeSnippet";

/** The code an Inbox line comment points at (the thread's file and line). */
export function InboxCodeSnippet({ item, thread }: { item: InboxEntry; thread: PrThread }) {
  return (
    <PrCodeSnippet
      organizationId={item.organizationId}
      projectId={item.projectId}
      repositoryId={item.repositoryId}
      pullRequestId={item.subjectId}
      filePath={thread.filePath}
      line={thread.rightLine ?? thread.leftLine}
      onNewSide={thread.rightLine != null}
    />
  );
}
