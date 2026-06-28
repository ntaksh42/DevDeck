import { type FormEvent, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Eye, EyeOff, GitBranch, Loader2, Plus } from 'lucide-react';
import {
  addAzureCliOrganization,
  addGithubOrganization,
  addPatOrganization,
  commandErrorMessage,
} from '@/lib/azdoCommands';

type ProviderKind = "azdo" | "github";

export function SetupPanel({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<ProviderKind>("azdo");
  const [organization, setOrganization] = useState("");
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function onOrganizationConnected() {
    setOrganization("");
    setPat("");
    setValidationError(null);
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
  }

  const patMutation = useMutation({
    mutationFn: addPatOrganization,
    onSuccess: onOrganizationConnected,
  });

  const azureCliMutation = useMutation({
    mutationFn: addAzureCliOrganization,
    onSuccess: onOrganizationConnected,
  });

  const githubMutation = useMutation({
    mutationFn: addGithubOrganization,
    onSuccess: onOrganizationConnected,
  });

  function resetMutations() {
    patMutation.reset();
    azureCliMutation.reset();
    githubMutation.reset();
  }

  function selectProvider(next: ProviderKind) {
    setProvider(next);
    resetMutations();
    setValidationError(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetMutations();
    if (provider === "github") {
      if (!pat.trim()) {
        setValidationError("A GitHub personal access token is required.");
        return;
      }
      setValidationError(null);
      githubMutation.mutate({ pat });
      return;
    }
    if (!organization.trim() || !pat.trim()) {
      setValidationError("Organization and PAT are required.");
      return;
    }
    setValidationError(null);
    patMutation.mutate({ organization, pat });
  }

  function onConnectAzureCli() {
    resetMutations();
    if (!organization.trim()) {
      setValidationError("Organization is required.");
      return;
    }
    setValidationError(null);
    azureCliMutation.mutate({ organization });
  }

  const isConnecting =
    patMutation.isPending || azureCliMutation.isPending || githubMutation.isPending;
  const isGithub = provider === "github";

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">
              {compact ? "Add connection" : isGithub ? "Connect GitHub" : "Connect Azure DevOps"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Credentials are validated before they are saved.
            </p>
          </div>
        </div>
      </div>

      <form className="grid gap-3 p-3" onSubmit={onSubmit}>
        <div
          role="radiogroup"
          aria-label="Platform"
          className="inline-flex w-fit rounded-md border border-input p-0.5"
        >
          <button
            type="button"
            role="radio"
            aria-checked={!isGithub}
            onClick={() => selectProvider("azdo")}
            className={`inline-flex h-8 items-center gap-2 rounded px-3 text-sm font-medium ${
              !isGithub ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
            }`}
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            Azure DevOps
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isGithub}
            onClick={() => selectProvider("github")}
            className={`inline-flex h-8 items-center gap-2 rounded px-3 text-sm font-medium ${
              isGithub ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
            }`}
          >
            <GitBranch className="h-4 w-4" aria-hidden="true" />
            GitHub
          </button>
        </div>

        {isGithub ? null : (
          <label className="grid gap-2">
            <span className="text-sm font-medium">Organization</span>
            <input
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder="contoso"
              autoFocus={!compact}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
            />
          </label>
        )}

        <label className="grid gap-2">
          <span className="text-sm font-medium">Personal access token</span>
          <div className="flex h-9 overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
            <input
              value={pat}
              onChange={(event) => setPat(event.target.value)}
              type={showPat ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPat((value) => !value)}
              className="flex w-10 items-center justify-center border-l border-border text-muted-foreground hover:bg-secondary"
              aria-label={showPat ? "Hide PAT" : "Show PAT"}
            >
              {showPat ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </label>

        {validationError ? (
          <p role="alert" className="text-sm text-destructive">
            {validationError}
          </p>
        ) : null}

        {patMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(patMutation.error)}
          </p>
        ) : null}

        {azureCliMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(azureCliMutation.error)}
          </p>
        ) : null}

        {githubMutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(githubMutation.error)}
          </p>
        ) : null}

        {patMutation.isSuccess || azureCliMutation.isSuccess || githubMutation.isSuccess ? (
          <p className="text-sm text-green-700 dark:text-green-400">Connection added.</p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={isConnecting}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {patMutation.isPending || githubMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : isGithub ? (
              <GitBranch className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            {isGithub ? "Connect GitHub" : "Connect"}
          </button>
          {isGithub ? null : (
            <button
              type="button"
              disabled={isConnecting}
              onClick={onConnectAzureCli}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {azureCliMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Building2 className="h-4 w-4" aria-hidden="true" />
              )}
              Connect with Azure CLI
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function formatAuthProvider(value: string): string {
  if (value === "azure_cli") return "Azure CLI";
  if (value === "github_pat") return "GitHub PAT";
  return value.toUpperCase();
}
