import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { moveColumnTo, useColumnDrag } from "@/lib/columnDrag";
import { loadBoardManualOrder, saveBoardManualOrder } from "./pipelineBoard";
import { subscriptionKey, type PipelineSubscription } from "./pipelineSubscriptionsStorage";

export function usePipelineManualOrder(subscriptions: PipelineSubscription[], rootEl: HTMLElement | null) {
  const [manualOrder, setManualOrder] = useState(loadBoardManualOrder);
  const pendingFocus = useRef<string | null>(null);
  function reorder(from: string, to: string, keepFocus = false) {
    const keys = new Set(subscriptions.map((sub) => subscriptionKey(sub.organizationId, sub.projectId, sub.definitionId)));
    if (from === to || !keys.has(from) || !keys.has(to)) return;
    if (keepFocus) pendingFocus.current = from;
    setManualOrder((current) => {
      const order = [...new Set([...current.filter((key) => keys.has(key)), ...keys])];
      return moveColumnTo(order, from, to);
    });
  }
  const pipelineDrag = useColumnDrag(reorder);
  useEffect(() => saveBoardManualOrder(manualOrder), [manualOrder]);
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    rootEl?.querySelector<HTMLElement>(`[data-board-header="${CSS.escape(key)}"]`)?.focus();
  }, [manualOrder, rootEl]);
  return { manualOrder, pipelineDrag, reorderPipeline: reorder };
}
