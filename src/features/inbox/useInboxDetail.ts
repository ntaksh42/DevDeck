import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addWorkItemComment,
  commandErrorMessage,
  getPullRequestReview,
  getWorkItemPreview,
  postPullRequestComment,
  prLocator,
  setPullRequestThreadStatus,
  type PrThread,
  type PullRequestReview,
  type WorkItemPreview,
} from "@/lib/azdoCommands";
import {
  extractInboxLinks,
  isPullRequestItem,
  isWorkItemItem,
  type InboxEntry,
  type InboxLink,
} from "./inboxPresentation";

export type InboxDetail = {
  review: PullRequestReview | null;
  thread: PrThread | null;
  workItem: WorkItemPreview | null;
  links: InboxLink[];
  isLoading: boolean;
  error: string | null;
  busy: boolean;
  reply: (content: string) => Promise<void>;
  setResolved: (resolved: boolean) => Promise<void>;
  commentOnWorkItem: (markdown: string) => Promise<void>;
};

/**
 * Loads what the preview of one Inbox entry needs (the pull request and its
 * thread, or the work item with its comments) and exposes the actions that
 * handle it. PR data shares the My Reviews review cache.
 */
export function useInboxDetail(item: InboxEntry | null): InboxDetail {
  const queryClient = useQueryClient();
  const isPr = !!item && isPullRequestItem(item);
  const isWorkItem = !!item && isWorkItemItem(item);
  const locator = item
    ? prLocator({
        organizationId: item.organizationId,
        projectId: item.projectId,
        repositoryId: item.repositoryId,
        pullRequestId: item.subjectId,
      })
    : null;

  const reviewQuery = useQuery({
    queryKey: ["prReview", item?.organizationId, item?.repositoryId, item?.subjectId],
    queryFn: () => getPullRequestReview(locator as NonNullable<typeof locator>),
    enabled: isPr,
    staleTime: 60_000,
  });
  const review = isPr ? (reviewQuery.data ?? null) : null;
  const thread: PrThread | null = useMemo(
    () => review?.threads.find((candidate) => candidate.id === item?.threadId) ?? null,
    [review, item?.threadId],
  );

  const workItemQuery = useQuery({
    queryKey: ["inboxWorkItem", item?.organizationId, item?.projectId, item?.subjectId],
    queryFn: () =>
      getWorkItemPreview({
        organizationId: item?.organizationId,
        projectId: item?.projectId ?? "",
        workItemId: item?.subjectId ?? 0,
      }),
    enabled: isWorkItem,
    staleTime: 30_000,
  });
  const workItem = isWorkItem ? (workItemQuery.data ?? null) : null;

  const links: InboxLink[] = useMemo(() => {
    if (!item) return [];
    if (isPr && thread) {
      return extractInboxLinks(
        thread.comments.filter((comment) => !comment.isSystem).map((comment) => comment.content),
      );
    }
    if (isWorkItem && workItem) {
      const mention = workItem.comments.find((comment) => comment.id === item.commentId);
      return extractInboxLinks([mention?.text ?? item.snippet]);
    }
    return extractInboxLinks([item.snippet]);
  }, [item, isPr, isWorkItem, thread, workItem]);

  function invalidateReview() {
    if (!item) return;
    void queryClient.invalidateQueries({
      queryKey: ["prReview", item.organizationId, item.repositoryId, item.subjectId],
    });
    void queryClient.invalidateQueries({ queryKey: ["myReviews", item.organizationId] });
  }

  const replyMutation = useMutation({ mutationFn: postPullRequestComment, onSuccess: invalidateReview });
  const statusMutation = useMutation({
    mutationFn: setPullRequestThreadStatus,
    onSuccess: invalidateReview,
  });
  const commentMutation = useMutation({
    mutationFn: addWorkItemComment,
    onSuccess: () => {
      if (!item) return;
      void queryClient.invalidateQueries({
        queryKey: ["inboxWorkItem", item.organizationId, item.projectId, item.subjectId],
      });
    },
  });
  const mutationError =
    replyMutation.error ??
    statusMutation.error ??
    commentMutation.error;
  const loadError = isPr
    ? reviewQuery.isError
      ? reviewQuery.error
      : null
    : isWorkItem && workItemQuery.isError
      ? workItemQuery.error
      : null;

  return {
    review,
    thread,
    workItem,
    links,
    isLoading: (isPr && reviewQuery.isLoading) || (isWorkItem && workItemQuery.isLoading),
    error: loadError
      ? commandErrorMessage(loadError)
      : mutationError
        ? commandErrorMessage(mutationError)
        : null,
    busy:
      replyMutation.isPending ||
      statusMutation.isPending ||
      commentMutation.isPending,
    async reply(content) {
      if (!item || !locator) return;
      await replyMutation.mutateAsync({ ...locator, threadId: item.threadId, content });
    },
    async setResolved(resolved) {
      if (!item || !locator) return;
      await statusMutation.mutateAsync({
        ...locator,
        threadId: item.threadId,
        status: resolved ? "closed" : "active",
      });
    },
    async commentOnWorkItem(markdown) {
      if (!item) return;
      await commentMutation.mutateAsync({
        organizationId: item.organizationId,
        projectId: item.projectId,
        workItemId: item.subjectId,
        markdown,
      });
    },
  };
}
