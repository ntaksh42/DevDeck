import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

/**
 * A refetch carries the server's current values (including changes made by
 * others since a bulk edit), so the local overrides for edited rows go.
 */
export function useDropOverridesOnRefetch<V>(
  dataUpdatedAt: number | undefined,
  setItemOverrides: Dispatch<SetStateAction<Map<string, V>>>,
) {
  const lastDataUpdatedAt = useRef(dataUpdatedAt);
  useEffect(() => {
    if (lastDataUpdatedAt.current === dataUpdatedAt) return;
    lastDataUpdatedAt.current = dataUpdatedAt;
    setItemOverrides((current) => (current.size === 0 ? current : new Map()));
  }, [dataUpdatedAt, setItemOverrides]);
}
