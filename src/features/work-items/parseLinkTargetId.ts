// Parses the "link target" input of the Links section. The whole string must be
// an integer (an optional leading "#" is allowed, e.g. when pasted from the UI)
// so typos like "12abc" or "1e3" are rejected instead of linking another item.
export function parseLinkTargetId(
  raw: string,
  selfId: number,
): { targetId: number } | { error: string } {
  const text = raw.trim().replace(/^#/, "");
  const targetId = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(targetId) || targetId <= 0) {
    return { error: "Enter a valid work item id." };
  }
  if (targetId === selfId) {
    return { error: "Cannot link a work item to itself." };
  }
  return { targetId };
}
