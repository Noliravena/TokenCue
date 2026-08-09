//! Cross-platform TokenCue JavaScript/TypeScript provider plugins.
//!
//! The manifest and host API mirror the macOS JavaScriptCore implementation,
//! while Windows evaluates source in a bounded `rquickjs` runtime. All
//! filesystem, process, browser-global, credential, and network capabilities
//! are denied unless explicitly mediated by this module.

pub mod approval;
pub mod loader;
pub mod manifest;
pub mod runtime;

use thiserror::Error;

use self::approval::PluginApprovalBinding;

pub type PluginResult<T> = Result<T, PluginError>;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("plugin load failed: {0}")]
    Load(String),
    #[error("invalid plugin manifest: {0}")]
    InvalidManifest(String),
    #[error("plugin security policy rejected the source: {0}")]
    SecurityPolicy(String),
    #[error("plugin network policy rejected the request: {0}")]
    NetworkPolicy(String),
    #[error("plugin approval store error: {0}")]
    Approval(String),
    #[error("plugin approval is required for '{id}'", id = .0.plugin_id)]
    ApprovalRequired(Box<PluginApprovalBinding>),
    #[error("plugin runtime failed: {0}")]
    Runtime(String),
    #[error("plugin script failed: {0}")]
    Script(String),
    #[error("invalid plugin snapshot: {0}")]
    InvalidSnapshot(String),
    #[error("plugin timed out")]
    TimedOut,
}
