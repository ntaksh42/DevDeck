use tauri::State;

use crate::app_state::AppState;
use crate::error::Result;
use crate::wiki::{GetWikiPageInput, SearchWikiPagesInput, WikiPageContent, WikiSearchResults};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn search_wiki_pages(
    input: SearchWikiPagesInput,
    state: State<'_, AppState>,
) -> Result<WikiSearchResults> {
    state.provider().await?.search_wiki_pages(input).await
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_wiki_page(
    input: GetWikiPageInput,
    state: State<'_, AppState>,
) -> Result<WikiPageContent> {
    state.provider().await?.get_wiki_page(input).await
}
