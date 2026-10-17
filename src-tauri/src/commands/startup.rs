use tauri::AppHandle;

use crate::error::Result;
use crate::tray;

/// Whether DevDeck is registered to start when the user signs in to Windows,
/// read back from the OS rather than from a stored setting.
#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn get_autostart_enabled(app: AppHandle) -> Result<bool> {
    tray::autostart_enabled(&app)
}

/// Registers or removes the sign-in startup entry; returns the state the OS reports afterwards.
#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn set_autostart_enabled(app: AppHandle, enabled: bool) -> Result<bool> {
    tray::set_autostart(&app, enabled)
}
