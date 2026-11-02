import { useRef, useState } from "react";
import { ConfirmDialog, useConfirm } from "@/components/ConfirmDialog";
import {
  applySettingsImport,
  buildSettingsExport,
  parseSettingsImport,
} from "@/lib/settingsTransfer";
import { SettingsRow } from "./SettingsRow";

const buttonClass =
  "inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-xs font-medium hover:bg-secondary";

function downloadJson(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function SettingsTransferSettings() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const { confirm, dialogProps } = useConfirm();

  function exportSettings() {
    const doc = buildSettingsExport(window.localStorage);
    const count = Object.keys(doc.entries).length;
    downloadJson(`devdeck-settings-${doc.exportedAt.slice(0, 10)}.json`, JSON.stringify(doc, null, 2));
    setMessage({ text: `Exported ${count} settings. Organizations and credentials are not included.`, error: false });
  }

  async function onFileChosen(file: File | undefined) {
    if (!file) return;
    const parsed = parseSettingsImport(await file.text());
    if (!parsed.ok) {
      setMessage({ text: parsed.error, error: true });
      importButtonRef.current?.focus();
      return;
    }
    const count = Object.keys(parsed.entries).length;
    confirm({
      title: "Import settings",
      message: `Overwrite ${count} local settings with the values from "${file.name}"? The app reloads afterwards.${
        parsed.skipped > 0 ? ` ${parsed.skipped} unsupported entries are ignored.` : ""
      }`,
      confirmLabel: "Import and reload",
      destructive: true,
      onConfirm: () => {
        applySettingsImport(parsed.entries);
        window.location.reload();
      },
    });
  }

  return (
    <SettingsRow
      title="Export / import settings"
      description={<>Move layouts, saved views, key bindings and color rules to another machine. Organizations and credentials are never included.</>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportSettings} className={buttonClass}>
          Export settings
        </button>
        <button
          ref={importButtonRef}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={buttonClass}
        >
          Import settings…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Settings file to import"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            void onFileChosen(file);
          }}
        />
        {message ? (
          <span role="status" className={`text-xs ${message.error ? "text-destructive" : "text-muted-foreground"}`}>
            {message.text}
          </span>
        ) : null}
      </div>
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
    </SettingsRow>
  );
}
