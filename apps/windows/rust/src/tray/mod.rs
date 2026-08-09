//! System tray module for TokenCue
//!
//! Provides icon types and tray management for the Windows system tray

pub mod icon;
pub mod render;

pub use icon::LoadingPattern;
pub use render::{TRAY_ICON_SIZE, render_bar_icon_rgba, render_percent_icon_rgba};
