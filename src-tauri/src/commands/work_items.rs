use tauri::State;

use crate::app_state::{ensure_write_enabled, run_blocking, AppState};
use crate::error::Result;
use crate::work_items::{
    AddWorkItemCommentInput, AddWorkItemLinkInput, AssignWorkItemsInput, BulkWorkItemResult,
    ClassificationNodesResult, DeleteWorkItemCommentInput, FetchWorkItemImageInput,
    FollowWorkItemInput, GetSavedQueryInput, GetWorkItemPreviewInput, ListClassificationNodesInput,
    ListFollowedWorkItemsInput, ListMyWorkItemsInput, ListWorkItemFieldAllowedValuesInput,
    ListWorkItemFieldsInput, ListWorkItemProjectsInput, ListWorkItemTypeStatesInput,
    ListWorkItemUpdatesInput, MentionCandidate, RecordAssigneeInteractionInput,
    RecordMentionInteractionInput, RemoveWorkItemLinkInput, RunWorkItemQueryInput,
    SavedQueryResult, SearchWorkItemAssigneesInput, SearchWorkItemMentionsInput,
    SearchWorkItemsInput, SetWorkItemCommentReactionInput, SetWorkItemsPriorityInput,
    SetWorkItemsStateInput, SetWorkItemsTagsInput, UnfollowWorkItemInput,
    UpdateWorkItemCommentInput, UpdateWorkItemFieldsInput, WorkItemAssigneeCandidate,
    WorkItemComment, WorkItemFieldOption, WorkItemImage, WorkItemPreview, WorkItemProjectOption,
    WorkItemSummary, WorkItemUpdateSummary,
};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_work_items(
    input: SearchWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.provider().await?.search_work_items(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_my_work_items(
    input: ListMyWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.provider().await?.list_my_work_items(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_work_item_projects(
    input: ListWorkItemProjectsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemProjectOption>> {
    state.provider().await?.list_work_item_projects(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn run_work_item_query(
    input: RunWorkItemQueryInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    state.work_items.run_query(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn count_work_item_query(
    input: RunWorkItemQueryInput,
    state: State<'_, AppState>,
) -> Result<usize> {
    state.work_items.count_query(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_work_item_preview(
    input: GetWorkItemPreviewInput,
    state: State<'_, AppState>,
) -> Result<WorkItemPreview> {
    state.provider().await?.get_work_item_preview(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_work_item_mentions(
    input: SearchWorkItemMentionsInput,
    state: State<'_, AppState>,
) -> Result<Vec<MentionCandidate>> {
    state
        .provider()
        .await?
        .search_work_item_mentions(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn record_mention_interaction(
    input: RecordMentionInteractionInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.work_items.clone();
    run_blocking(move || service.record_mention_interaction(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn record_assignee_interaction(
    input: RecordAssigneeInteractionInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.work_items.clone();
    run_blocking(move || service.record_assignee_interaction(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_work_item_assignees(
    input: SearchWorkItemAssigneesInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemAssigneeCandidate>> {
    state
        .provider()
        .await?
        .search_work_item_assignees(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn fetch_work_item_image(
    input: FetchWorkItemImageInput,
    state: State<'_, AppState>,
) -> Result<WorkItemImage> {
    state.work_items.fetch_image(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn add_work_item_comment(
    input: AddWorkItemCommentInput,
    state: State<'_, AppState>,
) -> Result<WorkItemComment> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.add_work_item_comment(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn add_work_item_link(
    input: AddWorkItemLinkInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.work_items.add_link(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn remove_work_item_link(
    input: RemoveWorkItemLinkInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.work_items.remove_link(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_work_item_comment(
    input: DeleteWorkItemCommentInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .delete_work_item_comment(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_work_item_comment(
    input: UpdateWorkItemCommentInput,
    state: State<'_, AppState>,
) -> Result<WorkItemComment> {
    ensure_write_enabled(&state).await?;
    state
        .provider()
        .await?
        .update_work_item_comment(input)
        .await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_work_item_comment_reaction(
    input: SetWorkItemCommentReactionInput,
    state: State<'_, AppState>,
) -> Result<()> {
    ensure_write_enabled(&state).await?;
    state.work_items.set_comment_reaction(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_work_item_updates(
    input: ListWorkItemUpdatesInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemUpdateSummary>> {
    state.provider().await?.list_work_item_updates(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_work_items_state(
    input: SetWorkItemsStateInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.set_work_items_state(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn assign_work_items(
    input: AssignWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.assign_work_items(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_work_items_priority(
    input: SetWorkItemsPriorityInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.set_work_items_priority(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_work_items_tags(
    input: SetWorkItemsTagsInput,
    state: State<'_, AppState>,
) -> Result<Vec<BulkWorkItemResult>> {
    ensure_write_enabled(&state).await?;
    state.provider().await?.set_work_items_tags(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn update_work_item_fields(
    input: UpdateWorkItemFieldsInput,
    state: State<'_, AppState>,
) -> Result<WorkItemPreview> {
    ensure_write_enabled(&state).await?;
    state.work_items.update_fields(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_work_item_field_allowed_values(
    input: ListWorkItemFieldAllowedValuesInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    state.work_items.list_field_allowed_values(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_work_item_type_states(
    input: ListWorkItemTypeStatesInput,
    state: State<'_, AppState>,
) -> Result<Vec<String>> {
    state.work_items.list_type_states(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_work_item_fields(
    input: ListWorkItemFieldsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemFieldOption>> {
    state.work_items.list_fields(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_classification_nodes(
    input: ListClassificationNodesInput,
    state: State<'_, AppState>,
) -> Result<ClassificationNodesResult> {
    state.work_items.list_classification_nodes(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_saved_query(
    input: GetSavedQueryInput,
    state: State<'_, AppState>,
) -> Result<SavedQueryResult> {
    state.work_items.get_saved_query(input).await
}

// Local follow watchlist (issue #304): no Azure DevOps API involved, so these
// skip `ensure_write_enabled` the same way `snooze_item` does.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn follow_work_item(
    input: FollowWorkItemInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.work_items.clone();
    run_blocking(move || service.follow_work_item(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn unfollow_work_item(
    input: UnfollowWorkItemInput,
    state: State<'_, AppState>,
) -> Result<()> {
    let service = state.work_items.clone();
    run_blocking(move || service.unfollow_work_item(input)).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn list_followed_work_items(
    input: ListFollowedWorkItemsInput,
    state: State<'_, AppState>,
) -> Result<Vec<WorkItemSummary>> {
    let service = state.work_items.clone();
    run_blocking(move || service.list_followed_work_items(input)).await
}
