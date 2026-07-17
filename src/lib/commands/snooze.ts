import { z } from "zod";
import { invokeCommand } from "./runtime";

export type SnoozeItemType = "pull_request" | "work_item";

export type SnoozeItemInput = {
  organizationId?: string;
  itemType: SnoozeItemType;
  itemKey: string;
  snoozeUntil: string;
};

const snoozedItemSummarySchema = z.object({
  itemType: z.string(),
  itemKey: z.string(),
  snoozeUntil: z.string(),
  title: z.string().nullable(),
  subtitle: z.string().nullable(),
  webUrl: z.string().nullable(),
});

const snoozedItemSummariesSchema = z.array(snoozedItemSummarySchema);

export type SnoozedItemSummary = z.infer<typeof snoozedItemSummarySchema>;

export async function snoozeItem(input: SnoozeItemInput): Promise<void> {
  await invokeCommand("snooze_item", { input });
}

export async function snoozeItems(inputs: SnoozeItemInput[]): Promise<void> {
  await Promise.all(inputs.map((input) => snoozeItem(input)));
}

export async function unsnoozeItem(input: {
  organizationId?: string;
  itemType: SnoozeItemType;
  itemKey: string;
}): Promise<void> {
  await invokeCommand("unsnooze_item", { input });
}

export async function listSnoozedItems(input: {
  organizationId?: string;
  itemType: SnoozeItemType;
}): Promise<SnoozedItemSummary[]> {
  const result = await invokeCommand("list_snoozed_items", { input });
  return snoozedItemSummariesSchema.parse(result);
}
