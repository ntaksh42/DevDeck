import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  commandErrorMessage,
  exportDiagnostics,
  type DiagnosticsExport,
} from '@/lib/azdoCommands';
import { isTauriRuntime } from '@/lib/runtime';
import { useExperimentalFlag } from './useExperimentalFlags';

export function ExperimentalDiagnostics() {
  const enabled = useExperimentalFlag('diagnosticsExport');
  const [redact, setRedact] = useState(true);
  const [result, setResult] = useState<DiagnosticsExport | null>(null);

  const mutation = useMutation({
    mutationFn: exportDiagnostics,
    onSuccess: (exported) => setResult(exported),
  });

  if (!enabled) {
    return null;
  }

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary">
            <FileText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Diagnostics</h2>
            <p className="text-sm text-muted-foreground">
              Writes app version, sync state, and recent errors to the review result
              folder. Tokens and credentials are never included.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={redact}
            onChange={(event) => setRedact(event.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Replace organization names with placeholders
        </label>

        <div>
          <button
            type="button"
            onClick={() => mutation.mutate({ redactOrganizations: redact })}
            disabled={mutation.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <FileText className="h-4 w-4" aria-hidden="true" />
            )}
            Export diagnostics
          </button>
        </div>

        {mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {commandErrorMessage(mutation.error)}
          </p>
        ) : null}

        {result ? (
          <div className="grid gap-2">
            <p className="text-sm text-green-700 dark:text-green-400">
              Diagnostics saved to {result.filePath}
            </p>
            {isTauriRuntime() ? (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    void openPath(result.filePath);
                  }}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-secondary"
                >
                  Open file
                </button>
              </div>
            ) : null}
            {/* Shown so the contents can be reviewed before the file is shared. */}
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                Preview report
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md border border-border bg-muted p-2 text-xs">
                {result.contents}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}
