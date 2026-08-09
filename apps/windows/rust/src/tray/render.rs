//! Pixel-level tray icon renderer, decoupled from any platform icon API.
//!
//! Returns raw RGBA bytes so callers (egui tray manager, Tauri shell, tests)
//! can adapt the result to their own icon type without pulling in extra deps.

use image::{ImageBuffer, Rgba, RgbaImage};

use super::icon::UsageLevel;

/// Side length of the generated tray icon in pixels.
pub const TRAY_ICON_SIZE: u32 = 32;

/// Render the four-column TokenCue signal glyph from the Windows handoff.
///
/// - `session_percent`: primary usage (0–100)
/// - `weekly_percent`: optional secondary usage. The most urgent value controls
///   the single glyph so the status remains legible at the real 16×16 tray size.
/// - `has_error`: render the stale-neutral four-bar glyph with the red incident badge.
///
/// Returns `(rgba_bytes, width, height)` for a [`TRAY_ICON_SIZE`]×[`TRAY_ICON_SIZE`] icon.
pub fn render_bar_icon_rgba(
    session_percent: f64,
    weekly_percent: Option<f64>,
    has_error: bool,
) -> (Vec<u8>, u32, u32) {
    const SZ: u32 = TRAY_ICON_SIZE;
    let mut img: RgbaImage = ImageBuffer::new(SZ, SZ);

    for pixel in img.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 0]);
    }

    // The handoff specifies a transparent 16×16 glyph. We render at 2× so
    // Windows can scale it crisply on 100–200% taskbar DPI.
    const BAR_WIDTH: u32 = 5;
    const BAR_GAP: u32 = 4;
    const BAR_HEIGHTS: [u32; 4] = [10, 18, 24, 12];
    const BASELINE: u32 = 30;
    const INACTIVE: Rgba<u8> = Rgba([255, 255, 255, 46]); // #ffffff2e

    let effective_percent = weekly_percent
        .map(|weekly| session_percent.max(weekly))
        .unwrap_or(session_percent)
        .clamp(0.0, 100.0);
    let active_bars = if has_error {
        4
    } else if effective_percent <= 0.0 {
        0
    } else {
        ((effective_percent / 25.0).ceil() as usize).clamp(1, 4)
    };
    let (r, g, b) = if has_error {
        UsageLevel::Unknown.color()
    } else {
        UsageLevel::from_percent(effective_percent).color()
    };
    let active = Rgba([r, g, b, 255]);

    for (index, height) in BAR_HEIGHTS.into_iter().enumerate() {
        let x = index as u32 * (BAR_WIDTH + BAR_GAP);
        let y = BASELINE - height;
        draw_rounded_bar(
            &mut img,
            x,
            y,
            BAR_WIDTH,
            height,
            if index < active_bars {
                active
            } else {
                INACTIVE
            },
        );
    }

    if has_error {
        draw_incident_badge(&mut img);
    }

    (img.into_raw(), SZ, SZ)
}

fn draw_rounded_bar(img: &mut RgbaImage, x: u32, y: u32, width: u32, height: u32, color: Rgba<u8>) {
    for yy in 0..height {
        for xx in 0..width {
            // A one-pixel corner cut at 2× density becomes the 1px radius from
            // the 16×16 handoff without introducing a blurry raster halo.
            let is_corner = (xx == 0 || xx == width - 1) && (yy == 0 || yy == height - 1);
            if !is_corner {
                img.put_pixel(x + xx, y + yy, color);
            }
        }
    }
}

fn draw_incident_badge(img: &mut RgbaImage) {
    const CENTER_X: i32 = 28;
    const CENTER_Y: i32 = 4;
    const RADIUS: i32 = 4;
    const INCIDENT: Rgba<u8> = Rgba([217, 86, 79, 255]);

    for y in 0..TRAY_ICON_SIZE as i32 {
        for x in 0..TRAY_ICON_SIZE as i32 {
            let dx = x - CENTER_X;
            let dy = y - CENTER_Y;
            if dx * dx + dy * dy <= RADIUS * RADIUS {
                img.put_pixel(x as u32, y as u32, INCIDENT);
            }
        }
    }
}

/// Render a compact numeric percent tray icon as raw RGBA bytes.
pub fn render_percent_icon_rgba(percent: f64, has_error: bool) -> (Vec<u8>, u32, u32) {
    const SZ: u32 = TRAY_ICON_SIZE;
    let mut img: RgbaImage = ImageBuffer::new(SZ, SZ);

    for pixel in img.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 0]);
    }

    let bg_alpha: u8 = if has_error { 180 } else { 255 };
    for y in 2..SZ - 2 {
        for x in 2..SZ - 2 {
            img.put_pixel(x, y, Rgba([60, 60, 70, bg_alpha]));
        }
    }

    let pct = percent.clamp(0.0, 100.0).round() as u32;
    let text = if pct >= 100 {
        "100".to_string()
    } else {
        format!("{pct}%")
    };
    let glyph_width = 3u32;
    let glyph_gap = 1u32;
    let scale = if text.len() >= 3 { 2u32 } else { 3u32 };
    let text_width = text.len() as u32 * glyph_width * scale + (text.len() as u32 - 1) * glyph_gap;
    let text_height = 5 * scale;
    let start_x = (SZ.saturating_sub(text_width)) / 2;
    let start_y = (SZ.saturating_sub(text_height)) / 2;

    let (r, g, b) = UsageLevel::from_percent(percent).color();
    let color = if has_error {
        let gray = ((r as u16 + g as u16 + b as u16) / 3) as u8;
        Rgba([gray, gray, gray, 255])
    } else {
        Rgba([r, g, b, 255])
    };

    let mut x = start_x;
    for ch in text.chars() {
        draw_glyph(&mut img, ch, x, start_y, scale, color);
        x += glyph_width * scale + glyph_gap;
    }

    (img.into_raw(), SZ, SZ)
}

fn draw_glyph(img: &mut RgbaImage, ch: char, x: u32, y: u32, scale: u32, color: Rgba<u8>) {
    let Some(rows) = glyph_rows(ch) else {
        return;
    };
    for (row_idx, row) in rows.iter().enumerate() {
        for col in 0..3 {
            let bit = 1 << (2 - col);
            if row & bit == 0 {
                continue;
            }
            for yy in 0..scale {
                for xx in 0..scale {
                    let px = x + col * scale + xx;
                    let py = y + row_idx as u32 * scale + yy;
                    if px < TRAY_ICON_SIZE && py < TRAY_ICON_SIZE {
                        img.put_pixel(px, py, color);
                    }
                }
            }
        }
    }
}

fn glyph_rows(ch: char) -> Option<[u8; 5]> {
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
        '%' => [0b101, 0b001, 0b010, 0b100, 0b101],
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_produces_correct_dimensions() {
        let (rgba, w, h) = render_bar_icon_rgba(50.0, None, false);
        assert_eq!(w, TRAY_ICON_SIZE);
        assert_eq!(h, TRAY_ICON_SIZE);
        assert_eq!(rgba.len() as u32, w * h * 4);
    }

    #[test]
    fn secondary_metric_still_produces_correct_size() {
        let (rgba, w, h) = render_bar_icon_rgba(30.0, Some(60.0), false);
        assert_eq!(rgba.len() as u32, w * h * 4);
    }

    #[test]
    fn background_is_transparent_and_zero_usage_keeps_bars_inactive() {
        let (rgba, w, _h) = render_bar_icon_rgba(0.0, None, false);
        assert_eq!(pixel(&rgba, w, 15, 15), [0, 0, 0, 0]);
        assert_eq!(pixel(&rgba, w, 2, 25), [255, 255, 255, 46]);
    }

    #[test]
    fn sixty_four_percent_matches_three_bar_normal_warm_state() {
        let (rgba, w, _h) = render_bar_icon_rgba(64.0, None, false);
        assert_eq!(pixel(&rgba, w, 2, 25), [110, 143, 90, 255]);
        assert_eq!(pixel(&rgba, w, 11, 20), [110, 143, 90, 255]);
        assert_eq!(pixel(&rgba, w, 20, 10), [110, 143, 90, 255]);
        assert_eq!(pixel(&rgba, w, 29, 25), [255, 255, 255, 46]);
    }

    #[test]
    fn warning_and_critical_states_use_warm_palette() {
        let (warning, w, _) = render_bar_icon_rgba(87.0, None, false);
        assert_eq!(pixel(&warning, w, 29, 25), [199, 143, 42, 255]);

        let (critical, w, _) = render_bar_icon_rgba(95.0, None, false);
        assert_eq!(pixel(&critical, w, 29, 25), [187, 74, 61, 255]);
    }

    #[test]
    fn higher_secondary_metric_controls_the_single_signal_glyph() {
        let (rgba, w, _) = render_bar_icon_rgba(30.0, Some(87.0), false);
        assert_eq!(pixel(&rgba, w, 29, 25), [199, 143, 42, 255]);
    }

    #[test]
    fn error_state_uses_neutral_bars_and_red_incident_badge() {
        let (rgba, w, _) = render_bar_icon_rgba(10.0, None, true);
        assert_eq!(pixel(&rgba, w, 11, 20), [162, 152, 138, 255]);
        assert_eq!(pixel(&rgba, w, 28, 4), [217, 86, 79, 255]);
    }

    #[test]
    fn percent_icon_produces_correct_dimensions() {
        let (rgba, w, h) = render_percent_icon_rgba(72.0, false);
        assert_eq!(w, TRAY_ICON_SIZE);
        assert_eq!(h, TRAY_ICON_SIZE);
        assert_eq!(rgba.len() as u32, w * h * 4);
    }

    #[test]
    fn percent_icon_draws_visible_text() {
        let (rgba, _, _) = render_percent_icon_rgba(72.0, false);
        assert!(rgba.chunks_exact(4).any(|px| px[3] == 255 && px[0] != 60));
    }

    #[test]
    fn percent_icon_clamps_to_hundred() {
        let (rgba, w, h) = render_percent_icon_rgba(125.0, false);
        assert_eq!(rgba.len() as u32, w * h * 4);
    }

    fn pixel(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
        let idx = ((y * width + x) * 4) as usize;
        [rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]]
    }
}
