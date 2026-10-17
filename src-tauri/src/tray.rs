//! Tray residency and sign-in startup: the tray icon with its Show / Sync now /
//! Quit menu, hiding the window instead of closing it, and the autostart
//! registration the Startup settings panel toggles.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::oneshot;

use crate::app_state::AppState;
use crate::error::{AppError, Result};
use crate::sync::{SyncScope, SyncTrigger};

/// Passed to the app by the autostart registration so a sign-in launch can be
/// told apart from the user opening DevDeck.
pub const MINIMIZED_ARG: &str = "--minimized";

const TRAY_ID: &str = "devdeck-tray";

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show DevDeck", true, None::<&str>)?;
    let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &sync, &quit])?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("DevDeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => crate::show_main_window(app),
            "sync" => request_sync(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn request_sync(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let trigger = state.sync_trigger.clone();
    tauri::async_runtime::spawn(async move {
        let (done, _rx) = oneshot::channel();
        let _ = trigger
            .send(SyncTrigger {
                scope: SyncScope::All,
                force: true,
                done,
            })
            .await;
    });
}

/// With "keep running in the tray" on, the close button hides the window; the
/// sync loop and notifications keep running until Quit in the tray menu.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    let keep = window
        .app_handle()
        .try_state::<AppState>()
        .and_then(|state| state.db.get_app_settings().ok())
        .is_some_and(|settings| settings.keep_running_in_tray);
    if keep {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// True when this launch came from the sign-in registration.
pub fn launched_minimized() -> bool {
    std::env::args().any(|arg| arg == MINIMIZED_ARG)
}

pub fn autostart_enabled(app: &AppHandle) -> Result<bool> {
    app.autolaunch()
        .is_enabled()
        .map_err(|error| AppError::InvalidInput(format!("could not read autostart: {error}")))
}

pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<bool> {
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result
        .map_err(|error| AppError::InvalidInput(format!("could not change autostart: {error}")))?;
    autostart_enabled(app)
}
