import type { WorkItemComment } from "@/lib/azdoCommands";

const deletedDemoWorkItemComments = new Set<number>();
const demoCommentReactions = new Map<number, Map<string, { count: number; isMine: boolean }>>();
let demoCommentReactionsSeeded = false;

export function deleteDemoWorkItemComment(commentId: number): void {
  deletedDemoWorkItemComments.add(commentId);
}

export function isDeletedDemoWorkItemComment(commentId: number): boolean {
  return deletedDemoWorkItemComments.has(commentId);
}

function demoReactionsFor(commentId: number): Map<string, { count: number; isMine: boolean }> {
  if (!demoCommentReactionsSeeded) {
    demoCommentReactionsSeeded = true;
    demoCommentReactions.set(2, new Map([
      ["like", { count: 2, isMine: true }],
      ["heart", { count: 1, isMine: false }],
    ]));
  }
  let reactions = demoCommentReactions.get(commentId);
  if (!reactions) {
    reactions = new Map();
    demoCommentReactions.set(commentId, reactions);
  }
  return reactions;
}

export function demoReactionsList(commentId: number) {
  return [...demoReactionsFor(commentId).entries()]
    .filter(([, value]) => value.count > 0)
    .map(([reactionType, value]) => ({ reactionType, ...value }));
}

export function toggleDemoReaction(commentId: number, type: string, engaged: boolean): void {
  const reactions = demoReactionsFor(commentId);
  const current = reactions.get(type) ?? { count: 0, isMine: false };
  if (engaged && !current.isMine) {
    reactions.set(type, { count: current.count + 1, isMine: true });
  } else if (!engaged && current.isMine) {
    reactions.set(type, { count: Math.max(0, current.count - 1), isMine: false });
  }
}

export function escapeDemoHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function demoWorkItemComment(markdown?: string): WorkItemComment {
  return {
    id: Date.now(),
    text: markdown ?? "",
    renderedText: `<p>${escapeDemoHtml(markdown ?? "")}</p>`,
    createdBy: "Demo User",
    createdById: "demo-user",
    createdByUniqueName: "demo.user@contoso.example",
    createdDate: new Date().toISOString(),
  };
}
