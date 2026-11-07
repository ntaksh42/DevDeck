import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { commandErrorMessage, runWorkItemInvestigations, type WorkItemSummary } from "@/lib/azdoCommands";
import { pushToast } from "@/lib/toast";
import { InvestigateSplitButton, type InvestigateAgentChoice } from "./InvestigateSplitButton";

/** Hands the checked work items to the agent for an investigation, three at a time. */
export function BulkInvestigateButton({ items }: { items: WorkItemSummary[] }) {
  const [agent, setAgent] = useState<InvestigateAgentChoice>("");
  const mutation = useMutation({
    mutationFn: () =>
      runWorkItemInvestigations(
        items.map(({ organizationId, projectId, projectName, id, title }) => ({
          organizationId,
          projectId,
          projectName,
          id,
          title,
        })),
        agent || undefined,
      ),
    onSuccess: (count) =>
      pushToast(`Investigating ${count} work item${count === 1 ? "" : "s"}, three at a time. Results appear in the result folder.`),
    onError: (error) => pushToast(commandErrorMessage(error)),
  });
  return (
    <InvestigateSplitButton
      agent={agent}
      onAgentChange={setAgent}
      onRun={() => mutation.mutate()}
      pending={mutation.isPending}
      title="Investigate the selected work items with the agent, three at a time"
    />
  );
}
