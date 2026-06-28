import {
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  commandErrorMessage,
  listClassificationNodes,
  listOrganizations,
  listWorkItemFieldAllowedValues,
  listWorkItemTypeStates,
  searchWorkItemAssignees,
  type WorkItemAssigneeCandidate,
  type WorkItemPreview,
  type WorkItemSummary,
} from '@/lib/azdoCommands';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { workItemQueryKeys } from './queryKeys';
import { type CustomPreviewField } from './previewFieldsStorage';
import {
  customPreviewFieldValue,
  type StagedChanges,
} from './workItemChanges';
import {
  rankMentionCandidates,
  recentWorkItemAssigneeCandidates,
  recentWorkItemMentionCandidates,
  sortSelfLast,
  workItemMentionPriorityNames,
} from './workItemMentions';

export function useWorkItemPickerState({
  selectedItem,
  preview,
  customPreviewFields,
  setStagedChanges,
  openAssigneeRequest,
  openStateRequest,
  openPriorityRequest,
  openFieldRequest,
}: {
  selectedItem: WorkItemSummary | null;
  preview: WorkItemPreview | null;
  customPreviewFields: CustomPreviewField[];
  setStagedChanges: (action: SetStateAction<StagedChanges>) => void;
  openAssigneeRequest: number | undefined;
  openStateRequest: number | undefined;
  openPriorityRequest: number | undefined;
  openFieldRequest: number | undefined;
}) {
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [statePickerOpen, setStatePickerOpen] = useState(false);
  const [reasonEditorOpen, setReasonEditorOpen] = useState(false);
  const [priorityPickerOpen, setPriorityPickerOpen] = useState(false);
  const [areaPickerOpen, setAreaPickerOpen] = useState(false);
  const [iterationPickerOpen, setIterationPickerOpen] = useState(false);
  const [customFieldEditor, setCustomFieldEditor] = useState<string | null>(null);

  const handledOpenAssigneeRequest = useRef(0);
  const handledOpenFieldRequest = useRef(0);
  const handledOpenPriorityRequest = useRef(0);
  const handledOpenStateRequest = useRef(0);

  const statesQuery = useQuery({
    queryKey: workItemQueryKeys.typeStates(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      preview?.workItemType,
    ),
    queryFn: () =>
      listWorkItemTypeStates({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
        workItemType: preview?.workItemType ?? "",
      }),
    enabled: statePickerOpen && !!preview?.workItemType,
    staleTime: Infinity,
  });

  const classificationQuery = useQuery({
    queryKey: [
      "classificationNodes",
      selectedItem?.organizationId,
      selectedItem?.projectId,
    ],
    queryFn: () =>
      listClassificationNodes({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
      }),
    enabled: (areaPickerOpen || iterationPickerOpen) && !!selectedItem?.projectId,
    staleTime: 5 * 60_000,
  });

  const customFieldValuesQuery = useQuery({
    queryKey: workItemQueryKeys.fieldAllowedValues(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      preview?.workItemType,
      customFieldEditor,
    ),
    queryFn: () =>
      listWorkItemFieldAllowedValues({
        organizationId: selectedItem?.organizationId,
        projectId: selectedItem?.projectId ?? "",
        workItemType: preview?.workItemType ?? "",
        fieldReferenceName: customFieldEditor ?? "",
      }),
    enabled: customFieldEditor !== null && !!selectedItem && !!preview?.workItemType,
    staleTime: Infinity,
  });

  const organizationsQuery = useQuery({
    queryKey: ["organizations"],
    queryFn: listOrganizations,
    staleTime: 5 * 60_000,
  });

  const selfOrg = useMemo(
    () => organizationsQuery.data?.find((org) => org.id === selectedItem?.organizationId),
    [organizationsQuery.data, selectedItem?.organizationId],
  );

  const recentMentionOptions = useMemo(
    () => recentWorkItemMentionCandidates(preview),
    [preview],
  );
  const recentAssigneeOptions = useMemo(
    () => recentWorkItemAssigneeCandidates(preview),
    [preview],
  );
  const mentionPriorityNames = useMemo(
    () => workItemMentionPriorityNames(preview),
    [preview],
  );

  const assigneeDefaultQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      "",
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: "",
      }),
    enabled: !!selectedItem && assigneeOpen,
    staleTime: 60_000,
  });
  const debouncedAssigneeQuery = useDebouncedValue(assigneeQuery, 200);
  const assigneeOptionsQuery = useQuery({
    queryKey: workItemQueryKeys.assignees(
      selectedItem?.organizationId,
      selectedItem?.projectId,
      selectedItem?.id,
      debouncedAssigneeQuery,
    ),
    queryFn: () =>
      searchWorkItemAssignees({
        organizationId: selectedItem!.organizationId,
        projectId: selectedItem!.projectId,
        workItemId: selectedItem!.id,
        query: debouncedAssigneeQuery,
      }),
    enabled: !!selectedItem && assigneeOpen && debouncedAssigneeQuery.trim().length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const assigneeOptions = useMemo(
    () =>
      sortSelfLast(
        rankMentionCandidates({
          recent: [...recentAssigneeOptions, ...(assigneeDefaultQuery.data ?? [])],
          remote: assigneeOptionsQuery.data ?? [],
          query: assigneeQuery,
          priorityNames: mentionPriorityNames,
        }),
        selfOrg,
      ),
    [
      assigneeDefaultQuery.data,
      assigneeOptionsQuery.data,
      assigneeQuery,
      mentionPriorityNames,
      recentAssigneeOptions,
      selfOrg,
    ],
  );

  function assignTo(candidate: WorkItemAssigneeCandidate) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      assignee:
        candidate.displayName === preview?.assignedTo
          ? undefined
          : {
              assignValue: candidate.assignValue,
              displayName: candidate.displayName,
              id: candidate.id,
              uniqueName: candidate.uniqueName,
            },
    }));
    setAssigneeOpen(false);
    setAssigneeQuery("");
  }

  function setPriority(priority: number) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      priority: String(priority) === preview?.priority ? undefined : priority,
    }));
    setPriorityPickerOpen(false);
  }

  function stageState(state: string) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      state: state === preview?.state ? undefined : state,
      reason: undefined,
    }));
    setStatePickerOpen(false);
  }

  function stageReason(reason: string) {
    if (!selectedItem) return;
    setStagedChanges((current) => ({
      ...current,
      reason: reason === preview?.reason ? undefined : reason,
    }));
    setReasonEditorOpen(false);
  }

  function stageTags(tags: string[]) {
    if (!selectedItem) return;
    const normalized = tags.join("; ");
    const currentTags = preview?.tags ?? "";
    setStagedChanges((current) => ({
      ...current,
      tags: normalized === currentTags ? undefined : tags,
    }));
  }

  function stageCustomField(referenceName: string, label: string, value: string) {
    if (!selectedItem) return;
    setStagedChanges((current) => {
      const fields = { ...current.fields };
      if (preview && (customPreviewFieldValue(preview, referenceName) ?? "") === value) {
        delete fields[referenceName];
      } else {
        fields[referenceName] = { label, value };
      }
      return { ...current, fields: Object.keys(fields).length > 0 ? fields : undefined };
    });
    setCustomFieldEditor(null);
  }

  function openNextCustomField() {
    if (!selectedItem || customPreviewFields.length === 0) return;
    const currentIndex = customPreviewFields.findIndex(
      (field) => field.referenceName === customFieldEditor,
    );
    const next = customPreviewFields[(currentIndex + 1) % customPreviewFields.length];
    setAssigneeOpen(false);
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    setCustomFieldEditor(next.referenceName);
  }
  const openNextCustomFieldRef = useRef<() => void>(() => {});
  openNextCustomFieldRef.current = openNextCustomField;

  // Reset all picker UI when the selected item changes.
  useEffect(() => {
    setAssigneeOpen(false);
    setAssigneeQuery("");
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    setCustomFieldEditor(null);
  }, [selectedItem?.id]);

  useEffect(() => {
    if (!openAssigneeRequest || handledOpenAssigneeRequest.current === openAssigneeRequest) return;
    handledOpenAssigneeRequest.current = openAssigneeRequest;
    if (!selectedItem) return;
    setAssigneeOpen(true);
    setStatePickerOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
    setAssigneeQuery("");
  }, [openAssigneeRequest, selectedItem]);

  useEffect(() => {
    if (!openStateRequest || handledOpenStateRequest.current === openStateRequest) return;
    handledOpenStateRequest.current = openStateRequest;
    if (!selectedItem) return;
    setStatePickerOpen(true);
    setAssigneeOpen(false);
    setReasonEditorOpen(false);
    setPriorityPickerOpen(false);
  }, [openStateRequest, selectedItem]);

  useEffect(() => {
    if (!openPriorityRequest || handledOpenPriorityRequest.current === openPriorityRequest) return;
    handledOpenPriorityRequest.current = openPriorityRequest;
    if (!selectedItem) return;
    setPriorityPickerOpen(true);
    setAssigneeOpen(false);
    setReasonEditorOpen(false);
    setStatePickerOpen(false);
  }, [openPriorityRequest, selectedItem]);

  useEffect(() => {
    if (!openFieldRequest || handledOpenFieldRequest.current === openFieldRequest) return;
    handledOpenFieldRequest.current = openFieldRequest;
    openNextCustomFieldRef.current();
  }, [openFieldRequest]);

  useEffect(() => {
    function openState() {
      if (!selectedItem) return;
      setStatePickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
    }
    function openAssignee() {
      if (!selectedItem) return;
      setAssigneeOpen(true);
      setStatePickerOpen(false);
      setReasonEditorOpen(false);
      setPriorityPickerOpen(false);
      setAssigneeQuery("");
    }
    function openPriority() {
      if (!selectedItem) return;
      setPriorityPickerOpen(true);
      setAssigneeOpen(false);
      setReasonEditorOpen(false);
      setStatePickerOpen(false);
    }
    function openField() { openNextCustomFieldRef.current(); }
    window.addEventListener("azdodeck:work-items:open-state", openState);
    window.addEventListener("azdodeck:work-items:open-assignee", openAssignee);
    window.addEventListener("azdodeck:work-items:open-priority", openPriority);
    window.addEventListener("azdodeck:work-items:open-field", openField);
    return () => {
      window.removeEventListener("azdodeck:work-items:open-state", openState);
      window.removeEventListener("azdodeck:work-items:open-assignee", openAssignee);
      window.removeEventListener("azdodeck:work-items:open-priority", openPriority);
      window.removeEventListener("azdodeck:work-items:open-field", openField);
    };
  }, [selectedItem]);

  return {
    assigneeOpen,
    setAssigneeOpen,
    assigneeQuery,
    setAssigneeQuery,
    statePickerOpen,
    setStatePickerOpen,
    reasonEditorOpen,
    setReasonEditorOpen,
    priorityPickerOpen,
    setPriorityPickerOpen,
    areaPickerOpen,
    setAreaPickerOpen,
    iterationPickerOpen,
    setIterationPickerOpen,
    customFieldEditor,
    setCustomFieldEditor,
    statesQuery,
    classificationQuery,
    customFieldValuesQuery,
    selfOrg,
    assigneeOptions,
    assigneeDefaultLoading: assigneeDefaultQuery.isLoading,
    assigneeOptionsLoading: assigneeOptionsQuery.isLoading,
    assigneeDefaultError: assigneeDefaultQuery.isError
      ? commandErrorMessage(assigneeDefaultQuery.error)
      : null,
    assigneeOptionsError: assigneeOptionsQuery.isError
      ? commandErrorMessage(assigneeOptionsQuery.error)
      : null,
    recentMentionOptions,
    recentAssigneeOptions,
    mentionPriorityNames,
    assignTo,
    setPriority,
    stageState,
    stageReason,
    stageTags,
    stageCustomField,
    openNextCustomField,
  };
}
