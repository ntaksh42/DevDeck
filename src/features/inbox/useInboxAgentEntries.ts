import { useQueries } from "@tanstack/react-query";
import { searchAll } from "@/lib/azdoCommands";
import type { InboxEntry } from "./inboxPresentation";

// Agent summaries contain only local note ids. Resolve their cached PR / WI
// metadata so opening the browser and gathering agent context have a real URL.
export function useInboxAgentEntries(entries: InboxEntry[], organizationId: string) {
  return useQueries({
    queries: entries.map((entry) => ({
      queryKey: ["inboxAgentSubject", organizationId, entry.extra?.agentTarget, entry.subjectId],
      queryFn: () => searchAll({
        organizationId: organizationId || undefined,
        query: String(entry.subjectId),
        limitPerKind: 50,
      }),
      enabled: entry.extra?.agentTarget !== "ask",
      staleTime: 60_000,
      retry: false,
    })),
    combine: (results): InboxEntry[] => entries.map((entry, index) => {
      const data = results[index].data;
      if (!data) return entry;
      if (entry.extra?.agentTarget === "pull-request") {
        const matches = data.pullRequests.filter((pr) => pr.pullRequestId === entry.subjectId);
        // The notes key has no organization. Do not open another org's item
        // when the same numeric id occurs in multiple organizations.
        if (matches.length !== 1) return entry;
        const pr = matches[0];
        return {
          ...entry,
          organizationId: pr.organizationId,
          projectId: pr.projectId,
          projectName: pr.projectName,
          repositoryId: pr.repositoryId,
          repositoryName: pr.repositoryName,
          title: pr.title,
          webUrl: pr.webUrl,
        };
      }
      if (entry.extra?.agentTarget === "work-item") {
        const matches = data.workItems.filter((item) => item.id === entry.subjectId);
        if (matches.length !== 1) return entry;
        const item = matches[0];
        return {
          ...entry,
          organizationId: item.organizationId,
          projectId: item.projectId,
          projectName: item.projectName,
          title: item.title,
          webUrl: item.webUrl,
        };
      }
      return entry;
    }),
  });
}
