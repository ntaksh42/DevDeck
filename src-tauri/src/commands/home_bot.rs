//! Home view: Look around suggestions and the Orchestrator chat.

use serde::Deserialize;
use tauri::State;

use crate::app_state::run_blocking;
use crate::error::Result;
use crate::home_bot::{
    HomeBot, HomeBotSettings, HomeBotView, HomeChatView, HomeSuggestionAsk, SendHomeMessageInput,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeSuggestionInput {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeWorkerInput {
    pub id: String,
}

#[tauri::command]
pub async fn get_home_bot(bot: State<'_, HomeBot>) -> Result<HomeBotView> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.view()).await
}

#[tauri::command]
pub async fn run_home_look_now(bot: State<'_, HomeBot>) -> Result<()> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.look_now()).await
}

#[tauri::command]
pub async fn mark_home_seen(bot: State<'_, HomeBot>) -> Result<()> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.mark_seen()).await
}

#[tauri::command]
pub async fn dismiss_home_suggestion(
    input: HomeSuggestionInput,
    bot: State<'_, HomeBot>,
) -> Result<()> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.dismiss(&input.id)).await
}

#[tauri::command]
pub async fn start_home_suggestion(
    input: HomeSuggestionInput,
    bot: State<'_, HomeBot>,
) -> Result<HomeSuggestionAsk> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.suggestion_ask(&input.id)).await
}

#[tauri::command]
pub async fn save_home_bot_settings(
    input: HomeBotSettings,
    bot: State<'_, HomeBot>,
) -> Result<HomeBotSettings> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.save_settings(input)).await
}

#[tauri::command]
pub async fn clear_home_dismissed(bot: State<'_, HomeBot>) -> Result<()> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.clear_dismissed()).await
}

#[tauri::command]
pub async fn count_home_dismissed(bot: State<'_, HomeBot>) -> Result<i64> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.dismissed_count()).await
}

#[tauri::command]
pub async fn get_home_chat(bot: State<'_, HomeBot>) -> Result<HomeChatView> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.chat_view()).await
}

#[tauri::command]
pub async fn send_home_message(input: SendHomeMessageInput, bot: State<'_, HomeBot>) -> Result<()> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.send_message(input)).await
}

#[tauri::command]
pub async fn new_home_chat(bot: State<'_, HomeBot>) -> Result<String> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.new_chat()).await
}

#[tauri::command]
pub async fn stop_home_worker(input: HomeWorkerInput, bot: State<'_, HomeBot>) -> Result<()> {
    let bot = bot.inner().clone();
    run_blocking(move || bot.stop_worker(&input.id)).await
}
