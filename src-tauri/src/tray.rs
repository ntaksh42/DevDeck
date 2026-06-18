//! System tray icon for AzDoDeck.
//!
//! The tray shows a live badge with the number of pull requests the signed-in
//! user is a required reviewer on but has not yet voted on (see
//! [`AppDatabase::count_unvoted_required_review_prs`]). The badge is recomputed
//! after every sync and the icon is redrawn so the count is visible while the
//! window is minimized. Clicking the tray icon brings the window forward and
//! asks the frontend to open the My Reviews view.
//!
//! Windows has no native tray badge, so the count is composited onto the base
//! icon as a red circle with white digits drawn from a tiny built-in bitmap
//! font (digits and `+` only, which is all the badge ever renders).

use std::sync::atomic::{AtomicI64, Ordering};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::show_main_window;

/// Emitted to the frontend when the user activates the tray; the React app
/// listens for it and switches to the My Reviews view.
pub const OPEN_MY_REVIEWS_EVENT: &str = "tray:open-my-reviews";

const TRAY_ID: &str = "main-tray";

/// The base (badge-free) icon bytes. Reused as the source bitmap every time the
/// badge is redrawn so repeated updates do not stack badges on top of badges.
const BASE_ICON_PNG: &[u8] = include_bytes!("../icons/32x32.png");

/// Remembers the last rendered count so we only redraw the icon when it
/// changes, avoiding needless work on every sync tick.
static LAST_COUNT: AtomicI64 = AtomicI64::new(-1);

struct BaseIcon {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

fn decode_base_icon() -> Option<BaseIcon> {
    let image = Image::from_bytes(BASE_ICON_PNG).ok()?;
    Some(BaseIcon {
        rgba: image.rgba().to_vec(),
        width: image.width(),
        height: image.height(),
    })
}

/// Creates the tray icon, wiring up the click-to-open behavior and a small
/// menu for keyboard/screen-reader access to the same actions. Called once
/// during app setup.
pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Open AzDoDeck", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let initial_icon = decode_base_icon()
        .map(|base| Image::new_owned(base.rgba, base.width, base.height))
        .or_else(|| app.default_window_icon().cloned())
        .ok_or_else(|| tauri::Error::AssetNotFound("tray base icon".into()))?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(initial_icon)
        .tooltip("AzDoDeck")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_my_reviews(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button, .. } = event {
                if button == MouseButton::Left {
                    open_my_reviews(tray.app_handle());
                }
            }
        })
        .build(app)?;
    Ok(())
}

fn open_my_reviews(app: &AppHandle) {
    show_main_window(app);
    let _ = app.emit_to("main", OPEN_MY_REVIEWS_EVENT, ());
}

/// Recomputes the unvoted-required-PR count and redraws the tray badge. Safe to
/// call from any thread; redraws only when the count actually changes.
pub fn refresh_badge(app: &AppHandle) {
    let count = match app.try_state::<crate::AppState>() {
        Some(state) => state.db.count_unvoted_required_review_prs().unwrap_or(0),
        None => return,
    };
    if LAST_COUNT.swap(count, Ordering::Relaxed) == count {
        return;
    }
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    apply_badge(&tray, count);
}

fn apply_badge(tray: &TrayIcon, count: i64) {
    let Some(base) = decode_base_icon() else {
        return;
    };
    let tooltip = if count > 0 {
        format!("AzDoDeck — {count} PR(s) awaiting your review")
    } else {
        "AzDoDeck".to_string()
    };
    let _ = tray.set_tooltip(Some(&tooltip));

    let mut rgba = base.rgba;
    if count > 0 {
        draw_badge(&mut rgba, base.width, base.height, count);
    }
    let image = Image::new_owned(rgba, base.width, base.height);
    let _ = tray.set_icon(Some(image));
}

/// Composites a red circular badge with the count onto the icon's lower-right
/// corner. Counts above 9 render as "9+" to keep the digits legible.
fn draw_badge(rgba: &mut [u8], width: u32, height: u32, count: i64) {
    let label = if count > 9 {
        "9+".to_string()
    } else {
        count.to_string()
    };

    // Badge geometry: a circle anchored to the bottom-right corner.
    let radius = (width as f32 * 0.42).round() as i32;
    let cx = width as i32 - radius;
    let cy = height as i32 - radius;
    let (red, green, blue) = (220u8, 38u8, 38u8); // tailwind red-600

    for y in (cy - radius).max(0)..(cy + radius).min(height as i32) {
        for x in (cx - radius).max(0)..(cx + radius).min(width as i32) {
            let dx = x - cx;
            let dy = y - cy;
            if dx * dx + dy * dy <= radius * radius {
                let idx = ((y as u32 * width + x as u32) * 4) as usize;
                rgba[idx] = red;
                rgba[idx + 1] = green;
                rgba[idx + 2] = blue;
                rgba[idx + 3] = 255;
            }
        }
    }

    // Center the digits in the badge. Each glyph is 3 wide; scale to fit.
    let glyph_count = label.chars().count() as i32;
    let scale = ((radius * 2) as f32 / (glyph_count as f32 * 4.0 + 1.0))
        .floor()
        .max(1.0) as i32;
    let text_w = (glyph_count * 3 + (glyph_count - 1)) * scale;
    let text_h = 5 * scale;
    let mut pen_x = cx - text_w / 2;
    let pen_y = cy - text_h / 2;
    for ch in label.chars() {
        draw_glyph(rgba, width, height, ch, pen_x, pen_y, scale);
        pen_x += 4 * scale;
    }
}

/// Draws a single white glyph from the 3x5 bitmap font at the given top-left
/// position, scaled by `scale`.
fn draw_glyph(rgba: &mut [u8], width: u32, height: u32, ch: char, ox: i32, oy: i32, scale: i32) {
    let Some(bitmap) = glyph_bitmap(ch) else {
        return;
    };
    for (row, bits) in bitmap.iter().enumerate() {
        for col in 0..3 {
            if bits & (1 << (2 - col)) == 0 {
                continue;
            }
            for sy in 0..scale {
                for sx in 0..scale {
                    let px = ox + col * scale + sx;
                    let py = oy + row as i32 * scale + sy;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        continue;
                    }
                    let idx = ((py as u32 * width + px as u32) * 4) as usize;
                    rgba[idx] = 255;
                    rgba[idx + 1] = 255;
                    rgba[idx + 2] = 255;
                    rgba[idx + 3] = 255;
                }
            }
        }
    }
}

/// 3x5 bitmap font, each row encoded in the low 3 bits (MSB = leftmost column).
fn glyph_bitmap(ch: char) -> Option<[u8; 5]> {
    Some(match ch {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_icon_decodes_to_rgba() {
        let icon = decode_base_icon().expect("base icon should decode");
        assert_eq!(icon.width, 32);
        assert_eq!(icon.height, 32);
        assert_eq!(icon.rgba.len(), (icon.width * icon.height * 4) as usize);
    }

    #[test]
    fn badge_paints_red_pixels_in_corner() {
        let base = decode_base_icon().unwrap();
        let mut rgba = base.rgba.clone();
        draw_badge(&mut rgba, base.width, base.height, 3);
        // The badge composites a red circle with white digits onto the
        // bottom-right corner; both colors must be present afterwards.
        let red_pixels = rgba
            .chunks_exact(4)
            .filter(|px| px == &[220, 38, 38, 255])
            .count();
        let white_pixels = rgba
            .chunks_exact(4)
            .filter(|px| px == &[255, 255, 255, 255])
            .count();
        assert!(red_pixels > 0, "expected red badge pixels");
        assert!(white_pixels > 0, "expected white digit pixels");
    }

    #[test]
    fn glyph_font_covers_digits_and_plus() {
        for ch in "0123456789+".chars() {
            assert!(glyph_bitmap(ch).is_some(), "missing glyph for {ch}");
        }
    }
}
