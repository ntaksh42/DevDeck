import { listMarkdown, type AgentListScope } from "@/components/agent/agentListScope";
import { inboxEntryKindLabel, inboxSubjectLabel, type InboxEntry, type InboxTab } from "./inboxPresentation";

/** The Inbox rows on screen, as the Agent panel's optional "This list" context. */
export function inboxAgentList(
  entries: readonly InboxEntry[],
  tab: InboxTab,
  filterText: string,
): AgentListScope {
  return {
    id: "inbox",
    label: "This list",
    count: entries.length,
    markdown: () =>
      listMarkdown({
        title: `Inbox (${tab})`,
        notes: [filterText.trim() && `Text filter: ${filterText.trim()}`],
        headers: ["Kind", "About", "Title", "Author", "Comment", "Detected"],
        rows: entries.map((entry) => [
          inboxEntryKindLabel(entry),
          inboxSubjectLabel(entry),
          entry.title,
          entry.author,
          entry.snippet,
          entry.detectedAt.slice(0, 10),
        ]),
      }),
  };
}
