//! Tray icon types
//!
//! Provides usage level, badge types, and loading animations for tray icon rendering

/// Usage status level for icon color
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UsageLevel {
    /// 0-70% used - healthy/normal
    Low,
    /// 70-95% used - amber
    High,
    /// 95-100% used - red
    Critical,
    /// Unknown/error state - stale neutral
    Unknown,
}

impl UsageLevel {
    pub fn from_percent(percent: f64) -> Self {
        match percent {
            p if p < 70.0 => UsageLevel::Low,
            p if p < 95.0 => UsageLevel::High,
            _ => UsageLevel::Critical,
        }
    }

    /// Get RGB color for this usage level
    pub fn color(&self) -> (u8, u8, u8) {
        match self {
            // Warm TokenCue palette: muted olive for healthy, amber for warning,
            // terracotta-red for critical (shared/design/tokens.json).
            UsageLevel::Low => (110, 143, 90),      // #6e8f5a
            UsageLevel::High => (199, 143, 42),     // #c78f2a
            UsageLevel::Critical => (187, 74, 61),  // #bb4a3d
            UsageLevel::Unknown => (162, 152, 138), // #a2988a
        }
    }
}

/// Badge type for status indicators
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum BadgeType {
    /// Warning indicator (yellow)
    Warning,
    /// Error/incident indicator (red)
    Incident,
    /// No badge
    None,
}

/// Loading animation patterns for tray icon
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum LoadingPattern {
    /// Knight Rider style - ping-pong sweep
    #[default]
    KnightRider,
    /// Cylon style - sawtooth linear
    Cylon,
    /// Outside-In - high at edges, dips in center
    OutsideIn,
    /// Race - fast linear fill
    Race,
    /// Pulse - throb between 40-100%
    Pulse,
    /// Unbraid - morphing effect (logo -> bars)
    Unbraid,
}

impl LoadingPattern {
    /// Calculate fill percentage for a given phase (0.0-1.0)
    pub fn value(&self, phase: f64) -> f64 {
        let phase = phase.fract(); // Ensure 0.0-1.0
        match self {
            LoadingPattern::KnightRider => {
                // Ping-pong: 0->100->0
                let t = (phase * 2.0).min(2.0 - phase * 2.0);
                t * 100.0
            }
            LoadingPattern::Cylon => {
                // Linear sawtooth: 0->100
                phase * 100.0
            }
            LoadingPattern::OutsideIn => {
                // Sinusoidal: high at edges
                ((phase * std::f64::consts::PI * 2.0).cos() * 0.5 + 0.5) * 100.0
            }
            LoadingPattern::Race => {
                // Fast sawtooth with easing
                let t = phase * phase; // Ease in
                t * 100.0
            }
            LoadingPattern::Pulse => {
                // Throb between 40-100%
                let t = (phase * std::f64::consts::PI * 2.0).sin() * 0.5 + 0.5;
                40.0 + t * 60.0
            }
            LoadingPattern::Unbraid => {
                // Morphing effect - starts compressed, expands to full
                // First half: bars grow from center outward
                // Second half: bars settle to loading position
                if phase < 0.5 {
                    let expand = phase * 2.0;
                    let ease = expand * expand * (3.0 - 2.0 * expand); // Smoothstep
                    ease * 80.0
                } else {
                    let settle = (phase - 0.5) * 2.0;
                    let ease = settle * settle * (3.0 - 2.0 * settle);
                    80.0 + ease * 20.0 * (settle * std::f64::consts::PI * 4.0).sin().abs()
                }
            }
        }
    }

    /// Get secondary bar offset (to make it animate differently)
    pub fn secondary_offset(&self) -> f64 {
        match self {
            LoadingPattern::KnightRider => 0.25,
            LoadingPattern::Cylon => 0.15,
            LoadingPattern::OutsideIn => 0.5,
            LoadingPattern::Race => 0.2,
            LoadingPattern::Pulse => 0.3,
            LoadingPattern::Unbraid => 0.1,
        }
    }

    /// Get all available patterns
    pub fn all() -> &'static [LoadingPattern] {
        &[
            LoadingPattern::KnightRider,
            LoadingPattern::Cylon,
            LoadingPattern::OutsideIn,
            LoadingPattern::Race,
            LoadingPattern::Pulse,
            LoadingPattern::Unbraid,
        ]
    }

    /// Get a random pattern
    pub fn random() -> Self {
        let patterns = Self::all();
        let idx = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as usize)
            % patterns.len();
        patterns[idx]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_usage_level_from_percent() {
        assert_eq!(UsageLevel::from_percent(0.0), UsageLevel::Low);
        assert_eq!(UsageLevel::from_percent(25.0), UsageLevel::Low);
        assert_eq!(UsageLevel::from_percent(69.9), UsageLevel::Low);
        assert_eq!(UsageLevel::from_percent(70.0), UsageLevel::High);
        assert_eq!(UsageLevel::from_percent(94.9), UsageLevel::High);
        assert_eq!(UsageLevel::from_percent(95.0), UsageLevel::Critical);
        assert_eq!(UsageLevel::from_percent(100.0), UsageLevel::Critical);
    }

    #[test]
    fn test_usage_level_color() {
        assert_eq!(UsageLevel::Low.color(), (110, 143, 90));
        assert_eq!(UsageLevel::High.color(), (199, 143, 42));
        assert_eq!(UsageLevel::Critical.color(), (187, 74, 61));
        assert_eq!(UsageLevel::Unknown.color(), (162, 152, 138));
    }

    #[test]
    fn test_badge_type_equality() {
        assert_eq!(BadgeType::None, BadgeType::None);
        assert_eq!(BadgeType::Warning, BadgeType::Warning);
        assert_eq!(BadgeType::Incident, BadgeType::Incident);
        assert_ne!(BadgeType::None, BadgeType::Warning);
    }
}
