import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { searchPullRequests, stopPullRequestSearch, commandErrorMessage, type PullRequestSearchResult, type PullRequestSummary, type SearchPullRequestsInput } from "@/lib/azdoCommands";
import { prSearchKey } from "./prSearchState";

export function useProgressivePrSearch(organizationId: string, progressive: boolean) {
  const mutation = useMutation({ mutationFn: searchPullRequests });
  const [rows, setRows] = useState<PullRequestSummary[]>([]);
  const [result, setResult] = useState<PullRequestSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [searched, setSearched] = useState(false);
  const generation = useRef(0);
  const currentOrg = useRef(organizationId);
  currentOrg.current = organizationId;
  const activeInput = useRef<SearchPullRequestsInput | null>(null);
  const busy = useRef(false);

  const reset = useCallback(() => {
    generation.current += 1;
    const input = activeInput.current;
    if (busy.current && input?.searchId) void stopPullRequestSearch({ organizationId: input.organizationId, searchId: input.searchId }).catch(() => {});
    activeInput.current = null; busy.current = false;
    setRows([]); setResult(null); setError(null); setPending(false); setStopping(false); setSearched(false);
  }, []);
  useEffect(() => { reset(); return () => { generation.current += 1; }; }, [organizationId, reset]);

  async function execute(input: SearchPullRequestsInput, append: boolean) {
    const epoch = generation.current;
    busy.current = true; setPending(true); setStopping(false); setError(null); setSearched(true);
    try {
      const page = await mutation.mutateAsync(input);
      if (epoch !== generation.current || input.organizationId !== currentOrg.current) return;
      setRows((current) => Array.from(new Map([...(append ? current : []), ...page.pullRequests].map((pr) => [prSearchKey(pr), pr])).values()));
      setResult(page);
    } catch (error) {
      if (epoch === generation.current && input.organizationId === currentOrg.current) setError(commandErrorMessage(error));
    } finally {
      if (epoch === generation.current && input.organizationId === currentOrg.current) { busy.current = false; setPending(false); setStopping(false); }
    }
  }

  function start(input: SearchPullRequestsInput) {
    reset();
    const request = { ...input, organizationId, ...(progressive ? { progressive: true, searchId: crypto.randomUUID() } : {}) };
    activeInput.current = request;
    setRows([]); setResult(null);
    void execute(request, false);
  }
  function continueSearch(retryFailed = false) {
    if (busy.current || !activeInput.current || !result?.continuationToken) return;
    void execute({ ...activeInput.current, continuationToken: result.continuationToken, retryFailed }, true);
  }
  async function stop() {
    const input = activeInput.current;
    if (!busy.current || !input?.searchId) return;
    const epoch = generation.current;
    setStopping(true);
    try { await stopPullRequestSearch({ organizationId: input.organizationId, searchId: input.searchId }); }
    catch (error) { if (epoch === generation.current) { setError(commandErrorMessage(error)); setStopping(false); } }
  }
  function openSummary(pr: PullRequestSummary) {
    reset(); setRows([pr]); setSearched(true);
  }
  return { rows, result, error, pending, stopping, searched, start, continueSearch, stop, reset, openSummary };
}
