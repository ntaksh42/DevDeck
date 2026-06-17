---
name: add-ipc-command
description: Scaffold a new Azure DevOps IPC command across all four layers of this Tauri + React app — Rust command + handler registration, domain service method, azdoCommands.ts wrapper + Zod schema, and the azdoDemo.ts browser-demo branch. Use when asked to add a new backend command or expose new Azure DevOps data to the frontend.
disable-model-invocation: true
---

Add a new IPC command end-to-end. This repo treats IPC as a four-part contract
(see `AGENTS.md`). Skipping any layer breaks either the desktop build, the
type-check, or browser dev (`pnpm dev`). Wire all four.

Pick a `snake_case` command name (e.g. `list_release_tags`). Tauri maps the Rust
fn name to that invoke key; the Rust fn, the `generate_handler![]` entry, and the
`invoke("<name>")` string must all match exactly.

## 1. Domain logic — service module (`src-tauri/src/<area>.rs`)

Put the real work on the matching service struct (`prs.rs`, `work_items.rs`,
`commits.rs`, `pipelines.rs`, `orgs.rs`, `settings.rs`, …). Most services hold
`db: AppDatabase` and `secrets: SecretStore`; route HTTP through `AdoClient`
(`get_json` / `post_json`) so retry/401/429 behavior stays consistent. Define
the input struct and the returned summary struct here (serde, camelCase via
`#[serde(rename_all = "camelCase")]` to match the Zod schema). Never return or
persist a PAT / Azure CLI token.

## 2. Tauri command + registration (`src-tauri/src/lib.rs`)

Add the command next to its siblings and register it:

```rust
#[tauri::command]
#[tracing::instrument(skip(state))]
async fn list_release_tags(
    input: ListReleaseTagsInput,
    state: State<'_, AppState>,
) -> Result<Vec<ReleaseTagOption>> {
    state.<service>.list_release_tags(input).await
}
```

Then add `list_release_tags,` inside `tauri::generate_handler![ ... ]` in the
same file. (If the service call is blocking, follow the existing
`run_blocking(move || ...)` pattern used elsewhere in `lib.rs`.)

## 3. Frontend wrapper + Zod schema (`src/lib/azdoCommands.ts`)

Add a Zod schema mirroring the Rust struct's serialized fields, an input type,
and a wrapper that calls the shared `invokeCommand` helper and `.parse()`s the
result. Do **not** call `invoke` directly and do **not** cast — parse with Zod:

```ts
const releaseTagOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
const releaseTagOptionsSchema = z.array(releaseTagOptionSchema);
export type ReleaseTagOption = z.infer<typeof releaseTagOptionSchema>;

export async function listReleaseTags(
  input: ListReleaseTagsInput,
): Promise<ReleaseTagOption[]> {
  const result = await invokeCommand("list_release_tags", { input });
  return releaseTagOptionsSchema.parse(result);
}
```

`invokeCommand` already routes to `invoke()` in Tauri and to `demoInvoke()` in
the browser, so the wrapper itself does not branch on runtime.

## 4. Browser demo branch (`src/lib/azdoDemo.ts`)

`demoInvoke(command, args)` is the browser fallback. Add a case for the new
command name returning shape-compatible fixture data (no secrets). The demo
implementation is required work, not polish — `pnpm dev` must keep working. Use
the demo org id `contoso` / project `demo-project` to stay consistent with other
fixtures.

## 5. Call it from React

Call the wrapper from the relevant feature under `src/features/`. Route server
state through TanStack Query; when the new data overlaps something already shown,
invalidate or update the relevant query keys rather than relying on rerenders.

## Verify before declaring done

- `pnpm tsc --noEmit`
- `pnpm test -- --run` (if behavior is testable)
- `cargo test --workspace` and, for lint-sensitive Rust, `cargo clippy --workspace --all-targets -- -D warnings`

Optionally run the `ipc-contract-reviewer` subagent to confirm all four layers
and the name consistency before finishing.
