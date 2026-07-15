import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useMemo,
  useState,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  commandErrorMessage,
  searchWorkItemMentions,
  type MentionCandidate,
  type Organization,
} from "@/lib/azdoCommands";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { workItemQueryKeys } from "./queryKeys";
import {
  activeMentionAt,
  addSelectedMention,
  mentionTokenDeletionStart,
  rankMentionCandidates,
  sortSelfLast,
  type SelectedMention,
} from "./workItemMentions";
import { useCloseOnOutsidePointer } from "./PreviewEditors";

// The organization/project/work item a mention search is scoped to. Passing
// `null` keeps the backend search disabled (used while a comment editor is
// closed) so no identity query fires for a textarea nobody is typing in.
export type WorkItemMentionScope = {
  organizationId: string;
  projectId: string;
  id: number;
};

export type MentionDropdownState = {
  options: MentionCandidate[];
  activeIndex: number;
  query: string;
  errorMessage: string | null;
};

/**
 * The stateful half of the @mention comment experience, extracted so the new
 * comment composer and the inline edit textarea share one implementation. The
 * pure token/ranking helpers stay in `workItemMentions.ts`; this hook owns the
 * picker state, the debounced identity search, and the keyboard handling. The
 * host owns the textarea value (`value`/`setValue`) and its own submit/cancel
 * keys — `handleKeyDown` only consumes mention keys and reports whether it did.
 */
export function useWorkItemMentionPicker({
  value,
  setValue,
  textareaRef,
  scope,
  recentMentionOptions,
  mentionPriorityNames,
  selfOrg,
  onMentionApplied,
}: {
  value: string;
  setValue: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  scope: WorkItemMentionScope | null;
  recentMentionOptions: MentionCandidate[];
  mentionPriorityNames: string[];
  selfOrg: Organization | undefined;
  onMentionApplied?: (candidate: MentionCandidate) => void;
}) {
  const [selectedMentions, setSelectedMentions] = useState<SelectedMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState<number | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  // Debounced so each keystroke does not fire a backend identity search;
  // keepPreviousData keeps the list visible while the next search runs.
  const debouncedMentionQuery = useDebouncedValue(mentionQuery, 200);
  const mentionOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.mentions(
      scope?.organizationId,
      scope?.projectId,
      scope?.id,
      debouncedMentionQuery,
    ),
    queryFn: () =>
      searchWorkItemMentions({
        organizationId: scope!.organizationId,
        projectId: scope!.projectId,
        workItemId: scope!.id,
        query: debouncedMentionQuery,
      }),
    enabled: !!scope && mentionStart !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const mentionOptions = useMemo(
    () =>
      // Self stays in the list but last: removing it entirely leaves the
      // picker empty in single-member organizations.
      sortSelfLast(
        rankMentionCandidates({
          recent: recentMentionOptions,
          remote: mentionOptionsQuery.data ?? [],
          query: mentionQuery,
          priorityNames: mentionPriorityNames,
        }),
        selfOrg,
      ),
    [
      mentionOptionsQuery.data,
      mentionPriorityNames,
      mentionQuery,
      recentMentionOptions,
      selfOrg,
    ],
  );

  const showMentionOptions = mentionStart !== null && mentionOptions.length > 0;
  const showMentionError =
    mentionStart !== null && mentionOptionsQuery.isError && mentionOptions.length === 0;

  function closePicker() {
    setMentionStart(null);
    setMentionQuery("");
  }

  const containerRef = useCloseOnOutsidePointer<HTMLDivElement>(
    showMentionOptions,
    closePicker,
  );

  function handleTextChange(text: string, cursor: number) {
    const mention = activeMentionAt(text, cursor);
    setMentionStart(mention?.start ?? null);
    setMentionQuery(mention?.query ?? "");
    setActiveMentionIndex(0);
  }

  // Re-evaluate the active token when the caret moves without editing (clicks/
  // arrow keys) using the host's current value.
  function handleSelectionChange(cursor: number) {
    handleTextChange(value, cursor);
  }

  function applyMention(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    const cursor = textarea?.selectionStart ?? value.length;
    const start = mentionStart ?? cursor;
    const replacement = `@${candidate.displayName} `;
    const next = `${value.slice(0, start)}${replacement}${value.slice(cursor)}`;
    const nextCursor = start + replacement.length;
    setValue(next);
    setSelectedMentions((current) => addSelectedMention(current, candidate));
    onMentionApplied?.(candidate);
    setMentionQuery("");
    setMentionStart(null);
    window.setTimeout(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  }

  function resetMentions() {
    setSelectedMentions([]);
    setMentionQuery("");
    setMentionStart(null);
    setActiveMentionIndex(0);
  }

  // Returns true when the key belonged to the picker so the host can early-out.
  // The host handles its own Ctrl+Enter (submit/save) before calling this, and
  // its own Escape/Enter only when this returns false.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    if (event.key === "Escape") {
      if (mentionStart !== null) {
        event.preventDefault();
        closePicker();
        return true;
      }
      return false;
    }

    if (
      event.key === "Backspace" &&
      event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const textarea = event.currentTarget;
      const cursor = textarea.selectionStart;
      const start = mentionTokenDeletionStart(
        value,
        cursor,
        selectedMentions.map((mention) => mention.displayName),
      );
      if (start !== null) {
        event.preventDefault();
        const next = value.slice(0, start) + value.slice(cursor);
        setValue(next);
        handleTextChange(next, start);
        window.setTimeout(() => textarea.setSelectionRange(start, start), 0);
        return true;
      }
    }

    if (!showMentionOptions) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((index) => (index + 1) % mentionOptions.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex(
        (index) => (index - 1 + mentionOptions.length) % mentionOptions.length,
      );
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      applyMention(mentionOptions[activeMentionIndex] ?? mentionOptions[0]);
      return true;
    }
    return false;
  }

  const dropdown: MentionDropdownState = {
    // Only surface options while an active @token is being typed; mentionOptions
    // is otherwise populated from recent participants even with the picker shut.
    options: showMentionOptions ? mentionOptions : [],
    activeIndex: activeMentionIndex,
    query: mentionQuery,
    errorMessage: showMentionError
      ? commandErrorMessage(mentionOptionsQuery.error)
      : null,
  };

  return {
    containerRef,
    handleTextChange,
    handleSelectionChange,
    handleKeyDown,
    applyMention,
    selectedMentions,
    resetMentions,
    dropdown,
  };
}
