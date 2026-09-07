import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import {
  listRepoBranches,
  type CommitRepositoryOption,
  type WorkItemProjectOption,
} from "@/lib/azdoCommands";
import { FilterableSelect } from "@/features/pipelines/FilterableSelect";
import { loadWorkItemQueryViews } from "@/features/work-items/workItemViewsStorage";
import {
  createAnalyzeMemberId,
  groupMemberCount,
  isAnalyzeGroupComplete,
  MAX_ANALYZE_GROUP_MEMBERS,
  normalizeBranchName,
  rangeOptions,
  type AnalyzeGranularity,
  type AnalyzeGroup,
} from "./analyzeGroupsStorage";

/** Mirrors the backend guard so the error surfaces before a request is made. */
function containsAsof(wiql: string): boolean {
  return /(^|[^\w[])asof\b/i.test(wiql);
}

export type AnalyzeGroupDialogProps = {
  group: AnalyzeGroup;
  isNew: boolean;
  projects: WorkItemProjectOption[];
  repositories: CommitRepositoryOption[];
  onSave: (group: AnalyzeGroup) => void;
  onClose: () => void;
};

export function AnalyzeGroupDialog({
  group,
  isNew,
  projects,
  repositories,
  onSave,
  onClose,
}: AnalyzeGroupDialogProps) {
  const [draft, setDraft] = useState<AnalyzeGroup>(group);
  const [error, setError] = useState<string | null>(null);
  const [wiqlDraft, setWiqlDraft] = useState("");
  const [wiqlName, setWiqlName] = useState("");
  const [showWiqlEditor, setShowWiqlEditor] = useState(false);
  const [repositoryId, setRepositoryId] = useState(repositories[0]?.repositoryId ?? "");
  const [branchDraft, setBranchDraft] = useState("");

  const selectedRepository = repositories.find((entry) => entry.repositoryId === repositoryId);
  const branchesQuery = useQuery({
    queryKey: [
      "analyzeRepoBranches",
      draft.organizationId,
      selectedRepository?.projectId,
      repositoryId,
    ],
    queryFn: () =>
      listRepoBranches({
        organizationId: draft.organizationId || undefined,
        project: selectedRepository!.projectId,
        repository: repositoryId,
      }),
    enabled: !!repositoryId && !!selectedRepository,
    staleTime: 5 * 60_000,
  });

  const branchOptions = useMemo(
    () =>
      (branchesQuery.data ?? []).map((branch) => ({
        value: branch.name,
        label: branch.isDefault ? `${branch.name} (default)` : branch.name,
      })),
    [branchesQuery.data],
  );
  // Fall back to free text when the branch list cannot be loaded, so a fetch
  // failure never blocks adding a branch the user already knows the name of.
  const showBranchPicker = !!selectedRepository && !branchesQuery.isError;

  // Offer the repository's default branch once the list arrives, but never
  // overwrite a name the user has already typed or picked.
  useEffect(() => {
    if (branchDraft) return;
    const fallback = branchesQuery.data?.find((branch) => branch.isDefault)?.name;
    if (fallback) setBranchDraft(fallback);
  }, [branchesQuery.data, branchDraft]);

  const restoreFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  // Saved views are the fastest way to fill a query; anything already carrying
  // its own ASOF cannot be sampled per point, so it is not offered.
  const savedViews = useMemo(
    () => loadWorkItemQueryViews().filter((view) => !containsAsof(view.wiql)),
    [],
  );

  const full = groupMemberCount(draft) >= MAX_ANALYZE_GROUP_MEMBERS;

  function close() {
    const target = restoreFocusRef.current;
    onClose();
    window.setTimeout(() => target?.focus(), 0);
  }

  function update(patch: Partial<AnalyzeGroup>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function setGranularity(granularity: AnalyzeGranularity) {
    const options = rangeOptions(granularity);
    // Ranges are unit-specific (days vs weeks), so pick the matching default
    // rather than carrying 30 across into a 30-week window.
    update({ granularity, rangeCount: granularity === "day" ? 30 : 12 });
    if (!options.includes(draft.rangeCount)) setError(null);
  }

  function addQueryFromView(viewId: string) {
    const view = savedViews.find((entry) => entry.id === viewId);
    if (!view) return;
    if (full) {
      setError(`メンバーは 1 グループ ${MAX_ANALYZE_GROUP_MEMBERS} 件までです。`);
      return;
    }
    update({
      queries: [
        ...draft.queries,
        {
          id: createAnalyzeMemberId(),
          name: view.name,
          projectId: view.projectId,
          wiql: view.wiql,
          milestones: [],
        },
      ],
    });
  }

  function addQueryFromWiql() {
    const wiql = wiqlDraft.trim();
    if (!wiql) {
      setError("WIQL を入力してください。");
      return;
    }
    if (containsAsof(wiql)) {
      setError("ASOF は Analyze 側で付与するため、WIQL には記述しないでください。");
      return;
    }
    if (full) {
      setError(`メンバーは 1 グループ ${MAX_ANALYZE_GROUP_MEMBERS} 件までです。`);
      return;
    }
    update({
      queries: [
        ...draft.queries,
        {
          id: createAnalyzeMemberId(),
          name: wiqlName.trim() || `Query ${draft.queries.length + 1}`,
          projectId: "",
          wiql,
          milestones: [],
        },
      ],
    });
    setWiqlDraft("");
    setWiqlName("");
    setShowWiqlEditor(false);
  }

  function addBranch() {
    const branch = normalizeBranchName(branchDraft);
    const repository = repositories.find((entry) => entry.repositoryId === repositoryId);
    if (!branch || !repository) {
      setError("リポジトリとブランチ名を指定してください。");
      return;
    }
    if (full) {
      setError(`メンバーは 1 グループ ${MAX_ANALYZE_GROUP_MEMBERS} 件までです。`);
      return;
    }
    update({
      branches: [
        ...draft.branches,
        {
          id: createAnalyzeMemberId(),
          name: branch,
          projectId: repository.projectId,
          repositoryId: repository.repositoryId,
          repositoryName: repository.repositoryName,
          branch,
        },
      ],
    });
    setBranchDraft("");
  }

  function save() {
    if (!isAnalyzeGroupComplete(draft)) {
      setError("グループ名と、クエリまたはブランチを1件以上指定してください。");
      return;
    }
    onSave(draft);
    close();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="analyze-group-dialog-title"
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        style={{ maxHeight: "90vh" }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Contained here so Escape never reaches the group list behind it.
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
            return;
          }
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.stopPropagation();
            event.preventDefault();
            save();
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="analyze-group-dialog-title" className="text-sm font-semibold">
            {isNew ? "グループを追加" : "グループを編集"}
          </h2>
          <button
            type="button"
            aria-label="ダイアログを閉じる"
            onClick={close}
            className="rounded p-1 text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold">グループ名</span>
            <input
              autoFocus
              type="text"
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold">既定のプロジェクト</span>
            <select
              value={draft.projectId}
              onChange={(event) => update({ projectId: event.target.value })}
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">選択してください…</option>
              {/* A stored project the account can no longer list would otherwise
                  be dropped silently on the next save, so keep it selectable. */}
              {draft.projectId &&
                !projects.some((project) => project.projectId === draft.projectId) && (
                  <option value={draft.projectId}>{draft.projectId} (一覧にありません)</option>
                )}
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectName}
                </option>
              ))}
            </select>
          </label>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold">
              クエリ{" "}
              <span className="font-normal text-muted-foreground">{draft.queries.length} 件</span>
            </h3>
            {draft.queries.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-primary/15 text-[0.65rem] font-bold text-primary">
                  Q
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{member.name}</span>
                  <span className="truncate font-mono text-[0.7rem] text-muted-foreground">
                    {member.wiql.replace(/\s+/g, " ")}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`${member.name} を削除`}
                  onClick={() =>
                    update({ queries: draft.queries.filter((entry) => entry.id !== member.id) })
                  }
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2">
              <span className="whitespace-nowrap text-xs">保存済みビューから追加</span>
              <select
                value=""
                aria-label="保存済みビュー"
                onChange={(event) => {
                  addQueryFromView(event.target.value);
                  event.target.value = "";
                }}
                className="min-w-[7rem] flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">選択してください…</option>
                {savedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowWiqlEditor((value) => !value)}
                className="whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                WIQL を直接書く
              </button>
            </div>

            {showWiqlEditor && (
              <div className="flex flex-col gap-2 rounded-md border border-border bg-card px-2.5 py-2">
                <input
                  type="text"
                  value={wiqlName}
                  placeholder="名前"
                  onChange={(event) => setWiqlName(event.target.value)}
                  className="rounded-md border border-border bg-card px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <textarea
                  value={wiqlDraft}
                  spellCheck={false}
                  rows={4}
                  placeholder={"SELECT [System.Id] FROM WorkItems\nWHERE [System.WorkItemType] = 'Bug'"}
                  onChange={(event) => setWiqlDraft(event.target.value)}
                  className="resize-y rounded-md border border-border bg-card px-2 py-1 font-mono text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <span className="text-[0.7rem] text-muted-foreground">
                  ASOF は Analyze 側で自動的に付与します。WIQL には書かないでください。
                </span>
                <button
                  type="button"
                  onClick={addQueryFromWiql}
                  className="flex items-center gap-1.5 self-start rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  クエリを追加
                </button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold">
              ブランチ{" "}
              <span className="font-normal text-muted-foreground">{draft.branches.length} 件</span>
            </h3>
            {draft.branches.map((member) => (
              <div
                key={member.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-muted-foreground/20 text-[0.65rem] font-bold text-muted-foreground">
                  B
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{member.branch}</span>
                  <span className="truncate text-[0.7rem] text-muted-foreground">
                    {member.repositoryName}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`${member.branch} を削除`}
                  onClick={() =>
                    update({ branches: draft.branches.filter((entry) => entry.id !== member.id) })
                  }
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 px-2.5 py-2">
              <select
                value={repositoryId}
                aria-label="リポジトリ"
                onChange={(event) => {
                  setRepositoryId(event.target.value);
                  // The previous repository's branch almost certainly does not
                  // exist in the new one, so clear it and let the default land.
                  setBranchDraft("");
                }}
                className="min-w-[7rem] flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {repositories.map((repository) => (
                  <option key={repository.repositoryId} value={repository.repositoryId}>
                    {repository.repositoryName}
                  </option>
                ))}
              </select>
              <span className="min-w-[8rem] flex-1">
                {showBranchPicker ? (
                  <FilterableSelect
                    value={branchDraft}
                    options={branchOptions}
                    onChange={setBranchDraft}
                    ariaLabel="ブランチ名"
                    placeholder={branchesQuery.isFetching ? "読み込み中…" : "ブランチを選択"}
                    allowCustomValue
                  />
                ) : (
                  <input
                    type="text"
                    value={branchDraft}
                    aria-label="ブランチ名"
                    placeholder="main"
                    onChange={(event) => setBranchDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addBranch();
                      }
                    }}
                    className="w-full rounded-md border border-border bg-card px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                )}
              </span>
              <button
                type="button"
                onClick={addBranch}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1 text-xs hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                ブランチを追加
              </button>
            </div>
          </section>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-semibold" id="analyze-granularity-label">
                既定の粒度
              </span>
              <div
                className="flex overflow-hidden rounded-md border border-border"
                role="group"
                aria-labelledby="analyze-granularity-label"
              >
                {(["day", "week"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={draft.granularity === value}
                    onClick={() => setGranularity(value)}
                    className={`flex-1 px-3 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                      draft.granularity === value
                        ? "bg-secondary font-semibold"
                        : "bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {value === "day" ? "Day" : "Week"}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-xs font-semibold">既定の期間</span>
              <select
                value={draft.rangeCount}
                onChange={(event) => update({ rangeCount: Number(event.target.value) })}
                className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {rangeOptions(draft.granularity).map((option) => (
                  <option key={option} value={option}>
                    直近 {option} {draft.granularity === "day" ? "日" : "週"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/35 px-4 py-3">
          <span className="text-[0.7rem] text-muted-foreground">
            Esc で閉じる · Ctrl+Enter で保存
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-border bg-card px-3.5 py-1.5 text-sm hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md border border-primary bg-primary px-3.5 py-1.5 text-sm font-semibold text-primary-foreground hover:brightness-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
