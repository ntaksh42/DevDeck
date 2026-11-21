import { inboxKindLabel, type InboxEntry } from "./inboxPresentation";

export type InboxFilterColumn = "kind" | "author" | "repo";

export const INBOX_FILTER_COLUMNS: InboxFilterColumn[] = ["kind", "author", "repo"];

export const INBOX_FILTER_LABELS: Record<InboxFilterColumn, string> = {
  kind: "Kind",
  author: "Author",
  repo: "Repo / Project",
};

/** The value each filterable column is matched on; Work Items have no repository, so they use the project. */
export const INBOX_FILTERABLE_COLUMNS: Record<InboxFilterColumn, (item: InboxEntry) => string> = {
  kind: (item) => inboxKindLabel(item.kind),
  author: (item) => item.author ?? "",
  repo: (item) => item.repositoryName || item.projectName,
};
