use serde::{Deserialize, Serialize};

use crate::agent_task_spawner::AgentCliInvocation;

pub const AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR: &str =
    "Agent launch options do not match the agent CLI kind.";
pub const AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR: &str =
    "Agent launch options include a capability the selected model does not support.";

/// A bounded model identifier; catalog membership is checked before execution.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClaudeModelChoice {
    bytes: [u8; 96],
    len: u8,
}

#[allow(non_upper_case_globals)]
impl ClaudeModelChoice {
    const fn literal(value: &str) -> Self {
        let mut bytes = [0; 96];
        let mut index = 0;
        while index < value.len() {
            bytes[index] = value.as_bytes()[index];
            index += 1;
        }
        Self {
            bytes,
            len: value.len() as u8,
        }
    }
    pub fn as_str(&self) -> &str {
        std::str::from_utf8(&self.bytes[..usize::from(self.len)]).expect("validated ASCII model ID")
    }
    pub const Default: Self = Self::literal("default");
    #[cfg(test)]
    pub const Fable: Self = Self::literal("fable");
    #[cfg(test)]
    pub const Opus: Self = Self::literal("opus");
    #[cfg(test)]
    pub const Sonnet: Self = Self::literal("sonnet");
    #[cfg(test)]
    pub const ClaudeFable51: Self = Self::literal("claude-fable-5-1");
    #[cfg(test)]
    pub const ClaudeFable5: Self = Self::literal("claude-fable-5");
    #[cfg(test)]
    pub const ClaudeOpus5: Self = Self::literal("claude-opus-5");
    #[cfg(test)]
    pub const ClaudeOpus48: Self = Self::literal("claude-opus-4-8");
    #[cfg(test)]
    pub const ClaudeOpus47: Self = Self::literal("claude-opus-4-7");
    #[cfg(test)]
    pub const ClaudeOpus46: Self = Self::literal("claude-opus-4-6");
    #[cfg(test)]
    pub const ClaudeOpus45: Self = Self::literal("claude-opus-4-5");
    #[cfg(test)]
    pub const ClaudeSonnet5: Self = Self::literal("claude-sonnet-5");
    #[cfg(test)]
    pub const ClaudeSonnet46: Self = Self::literal("claude-sonnet-4-6");
    #[cfg(test)]
    pub const ClaudeHaiku45: Self = Self::literal("claude-haiku-4-5");
}
impl Default for ClaudeModelChoice {
    fn default() -> Self {
        Self::Default
    }
}
impl Serialize for ClaudeModelChoice {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}
impl<'de> Deserialize<'de> for ClaudeModelChoice {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        let alias = matches!(value.as_str(), "default" | "fable" | "opus" | "sonnet");
        let model = value.strip_prefix("claude-").is_some_and(|suffix| {
            suffix.split('-').all(|part| {
                !part.is_empty()
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
        });
        if value.len() > 96 || (!alias && !model) {
            return Err(serde::de::Error::custom("Invalid Claude model identifier."));
        }
        Ok(Self::literal(&value))
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudePermissionMode {
    #[default]
    Default,
    Plan,
    Supervised,
    AcceptEdits,
    Auto,
    BypassPermissions,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum CodexModelChoice {
    #[default]
    #[serde(rename = "default")]
    Default,
    #[serde(rename = "gpt-6-astra")]
    Gpt6Astra,
    #[serde(rename = "gpt-5.6-sol")]
    Gpt56Sol,
    #[serde(rename = "gpt-5.6-terra")]
    Gpt56Terra,
    #[serde(rename = "gpt-5.6-luna")]
    Gpt56Luna,
    #[serde(rename = "gpt-5.5")]
    Gpt55,
    #[serde(rename = "gpt-5.4")]
    Gpt54,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeEffortChoice {
    #[default]
    Default,
    Low,
    Medium,
    High,
    Xhigh,
    Max,
    Ultracode,
    Ultrathink,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum ClaudeContextChoice {
    #[default]
    #[serde(rename = "200k")]
    TwoHundredK,
    #[serde(rename = "1m")]
    OneM,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodexExecutionMode {
    #[default]
    Default,
    ReadOnly,
    WorkspaceWrite,
    Auto,
    DangerFullAccess,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "provider", rename_all = "camelCase", deny_unknown_fields)]
pub enum AgentLaunchOptions {
    #[serde(rename_all = "camelCase")]
    ClaudeCode {
        model: ClaudeModelChoice,
        mode: ClaudePermissionMode,
        #[serde(default)]
        effort: ClaudeEffortChoice,
        #[serde(default)]
        context: ClaudeContextChoice,
        #[serde(default, skip_serializing_if = "is_false")]
        fast_mode: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        thinking_mode: bool,
        #[serde(default = "default_true", skip_serializing_if = "is_true")]
        chrome: bool,
    },
    #[serde(rename_all = "camelCase")]
    Codex {
        model: CodexModelChoice,
        mode: CodexExecutionMode,
    },
}

impl Default for AgentLaunchOptions {
    fn default() -> Self {
        Self::ClaudeCode {
            model: ClaudeModelChoice::Default,
            mode: ClaudePermissionMode::BypassPermissions,
            effort: ClaudeEffortChoice::High,
            context: ClaudeContextChoice::OneM,
            fast_mode: false,
            thinking_mode: false,
            chrome: true,
        }
    }
}

pub struct CatalogLaunchArgs {
    pub model: Vec<String>,
    pub settings: Vec<String>,
    pub effort: Vec<String>,
}

impl AgentLaunchOptions {
    pub fn invocation(&self) -> AgentCliInvocation {
        match self {
            Self::ClaudeCode { .. } => AgentCliInvocation::ClaudeCode,
            Self::Codex { .. } => AgentCliInvocation::CodexExec,
        }
    }

    pub fn matches(&self, invocation: AgentCliInvocation) -> bool {
        self.invocation() == invocation
    }

    pub fn is_dangerous(&self) -> bool {
        match self {
            Self::ClaudeCode { mode, .. } => *mode == ClaudePermissionMode::BypassPermissions,
            Self::Codex { mode, .. } => *mode == CodexExecutionMode::DangerFullAccess,
        }
    }

    pub fn validate_capabilities(&self) -> Result<(), &'static str> {
        let manifest = crate::claude_model_manifest::snapshot()
            .map_err(|_| AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)?;
        self.validate_manifest(&manifest, None)
    }

    pub fn validate_cli_version(&self, version: Option<&str>) -> Result<(), &'static str> {
        let manifest = crate::claude_model_manifest::snapshot()
            .map_err(|_| AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)?;
        self.validate_version_requirement(&manifest, version)
    }

    fn validate_version_requirement(
        &self,
        manifest: &crate::claude_model_manifest_domain::ClaudeModelManifest,
        version: Option<&str>,
    ) -> Result<(), &'static str> {
        if let Self::ClaudeCode { model, .. } = self {
            let entry = manifest
                .resolve_model(model.as_str())
                .ok_or(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)?;
            if version.is_none()
                && *model != ClaudeModelChoice::Default
                && (entry.min_version.is_some() || entry.max_version_exclusive.is_some())
            {
                return Err("Cannot verify the Claude Code version for this model. Refresh the provider status and try again.");
            }
        }
        self.validate_manifest(manifest, version)
    }

    fn validate_manifest(
        &self,
        manifest: &crate::claude_model_manifest_domain::ClaudeModelManifest,
        version: Option<&str>,
    ) -> Result<(), &'static str> {
        if let Self::ClaudeCode {
            model,
            effort,
            context,
            fast_mode,
            thinking_mode,
            ..
        } = self
        {
            let entry = manifest
                .resolve_model(model.as_str())
                .ok_or(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)?;
            let effort = match effort {
                ClaudeEffortChoice::Default => "default",
                ClaudeEffortChoice::Low => "low",
                ClaudeEffortChoice::Medium => "medium",
                ClaudeEffortChoice::High => "high",
                ClaudeEffortChoice::Xhigh => "xhigh",
                ClaudeEffortChoice::Max => "max",
                ClaudeEffortChoice::Ultracode => "ultracode",
                ClaudeEffortChoice::Ultrathink => "ultrathink",
            };
            let context = match context {
                ClaudeContextChoice::TwoHundredK => "200k",
                ClaudeContextChoice::OneM => "1m",
            };
            if (effort != "default" && !entry.efforts.iter().any(|value| value == effort))
                || (!entry.context_windows.is_empty()
                    && !entry.context_windows.iter().any(|value| value == context))
                || (*fast_mode && !entry.fast_mode)
                || (*thinking_mode && !entry.thinking_mode)
            {
                return Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR);
            }
            if let Some(version) = version {
                use crate::agent_task_spawner::agent_provider::compare_versions;
                use std::cmp::Ordering;
                if entry.min_version.as_ref().is_some_and(|min| {
                    !matches!(
                        compare_versions(version, min),
                        Some(Ordering::Equal | Ordering::Greater)
                    )
                }) || entry
                    .max_version_exclusive
                    .as_ref()
                    .is_some_and(|max| compare_versions(version, max) != Some(Ordering::Less))
                {
                    return Err(
                        "The installed Claude Code version does not support the selected model.",
                    );
                }
            }
        }
        Ok(())
    }

    pub fn model_args(&self) -> Vec<String> {
        let manifest = crate::claude_model_manifest::snapshot().expect("bundled catalog is valid");
        self.model_args_with_manifest(&manifest)
    }

    fn model_args_with_manifest(
        &self,
        manifest: &crate::claude_model_manifest_domain::ClaudeModelManifest,
    ) -> Vec<String> {
        match self {
            Self::ClaudeCode { model, context, .. } => {
                let supports_context = manifest
                    .resolve_model(model.as_str())
                    .is_some_and(|entry| !entry.context_windows.is_empty());
                claude_model_args(*model, *context, supports_context)
            }
            Self::Codex { model, .. } => codex_model_args(*model)
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        }
    }

    pub fn validated_catalog_args(
        &self,
        version: Option<&str>,
    ) -> Result<CatalogLaunchArgs, String> {
        let manifest = crate::claude_model_manifest::snapshot()?;
        self.validate_version_requirement(&manifest, version)
            .map_err(str::to_string)?;
        Ok(CatalogLaunchArgs {
            model: self.model_args_with_manifest(&manifest),
            settings: self.settings_args_with_manifest(&manifest),
            effort: self.effort_args_with_manifest(&manifest),
        })
    }

    pub fn mode_args(&self, resumed: bool) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { mode, .. } => claude_mode_args(*mode),
            Self::Codex { mode, .. } => codex_mode_args(*mode, resumed),
        }
    }

    pub fn browser_args(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { chrome: true, .. } => &["--chrome"],
            _ => &[],
        }
    }

    pub fn thinking_display_args(&self, version: Option<&str>) -> &'static [&'static str] {
        let Self::ClaudeCode { .. } = self else {
            return &[];
        };
        if !claude_supports_thinking_display(version) {
            return &[];
        }
        CLAUDE_SUMMARIZED_THINKING_DISPLAY_ARGS
    }

    #[cfg(test)]
    pub fn effort_args(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { effort, .. } => claude_effort_args(*effort),
            Self::Codex { .. } => &[],
        }
    }

    fn effort_args_with_manifest(
        &self,
        manifest: &crate::claude_model_manifest_domain::ClaudeModelManifest,
    ) -> Vec<String> {
        let Self::ClaudeCode { model, effort, .. } = self else {
            return Vec::new();
        };
        let source = match effort {
            ClaudeEffortChoice::Default => return Vec::new(),
            ClaudeEffortChoice::Low => "low",
            ClaudeEffortChoice::Medium => "medium",
            ClaudeEffortChoice::High => "high",
            ClaudeEffortChoice::Xhigh => "xhigh",
            ClaudeEffortChoice::Max => "max",
            ClaudeEffortChoice::Ultracode => "ultracode",
            ClaudeEffortChoice::Ultrathink => "ultrathink",
        };
        if let Some(target) = manifest
            .resolve_model(model.as_str())
            .and_then(|entry| entry.effort_map.as_ref())
            .and_then(|mapping| mapping.get(source))
        {
            return target
                .as_ref()
                .map_or_else(Vec::new, |target| vec!["--effort".into(), target.clone()]);
        }
        claude_effort_args(*effort)
            .iter()
            .map(|value| (*value).into())
            .collect()
    }

    #[cfg(test)]
    pub fn settings_args(&self) -> Vec<String> {
        let manifest = crate::claude_model_manifest::snapshot().expect("bundled catalog is valid");
        self.settings_args_with_manifest(&manifest)
    }

    fn settings_args_with_manifest(
        &self,
        manifest: &crate::claude_model_manifest_domain::ClaudeModelManifest,
    ) -> Vec<String> {
        let Self::ClaudeCode {
            model,
            thinking_mode,
            fast_mode,
            effort,
            ..
        } = self
        else {
            return Vec::new();
        };
        let mut settings = serde_json::Map::new();
        if manifest
            .resolve_model(model.as_str())
            .is_some_and(|entry| entry.thinking_mode)
        {
            settings.insert("alwaysThinkingEnabled".into(), (*thinking_mode).into());
        }
        if *fast_mode {
            settings.insert("fastMode".into(), true.into());
        }
        if *effort == ClaudeEffortChoice::Ultracode {
            settings.insert("ultracode".into(), true.into());
        }
        if settings.is_empty() {
            Vec::new()
        } else {
            vec![
                "--settings".into(),
                serde_json::Value::Object(settings).to_string(),
            ]
        }
    }

    pub fn prompt<'a>(&self, prompt: &'a str) -> std::borrow::Cow<'a, str> {
        match self {
            Self::ClaudeCode {
                effort: ClaudeEffortChoice::Ultrathink,
                ..
            } => claude_ultrathink_prompt(prompt),
            _ => std::borrow::Cow::Borrowed(prompt),
        }
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

fn is_true(value: &bool) -> bool {
    *value
}

fn default_true() -> bool {
    true
}

fn claude_effort_args(effort: ClaudeEffortChoice) -> &'static [&'static str] {
    match effort {
        ClaudeEffortChoice::Default => &[],
        ClaudeEffortChoice::Low => &["--effort", "low"],
        ClaudeEffortChoice::Medium => &["--effort", "medium"],
        ClaudeEffortChoice::High => &["--effort", "high"],
        ClaudeEffortChoice::Xhigh => &["--effort", "xhigh"],
        ClaudeEffortChoice::Max => &["--effort", "max"],
        ClaudeEffortChoice::Ultracode => &["--effort", "xhigh"],
        ClaudeEffortChoice::Ultrathink => &[],
    }
}

fn claude_ultrathink_prompt(prompt: &str) -> std::borrow::Cow<'_, str> {
    let trimmed = prompt.trim();
    if trimmed.starts_with("Ultrathink:") || is_claude_slash_command(trimmed) {
        return std::borrow::Cow::Borrowed(trimmed);
    }
    std::borrow::Cow::Owned(format!("Ultrathink:\n{trimmed}"))
}

fn is_claude_slash_command(prompt: &str) -> bool {
    let Some(command) = prompt.strip_prefix('/') else {
        return false;
    };
    let first_token = command.split_whitespace().next().unwrap_or_default();
    !first_token.is_empty() && !first_token.contains('/')
}

fn claude_model_args(
    model: ClaudeModelChoice,
    context: ClaudeContextChoice,
    supports_context: bool,
) -> Vec<String> {
    if model == ClaudeModelChoice::Default {
        return Vec::new();
    }
    let suffix = if supports_context && context == ClaudeContextChoice::OneM {
        "[1m]"
    } else {
        ""
    };
    vec!["--model".to_string(), format!("{}{suffix}", model.as_str())]
}

pub const CLAUDE_THINKING_DISPLAY_MIN_VERSION: &str = "2.1.220";
const CLAUDE_SUMMARIZED_THINKING_DISPLAY_ARGS: &[&str] = &["--thinking-display", "summarized"];

fn claude_supports_thinking_display(version: Option<&str>) -> bool {
    use crate::agent_task_spawner::agent_provider::compare_versions;
    use std::cmp::Ordering;
    let Some(version) = version else {
        return false;
    };
    matches!(
        compare_versions(version, CLAUDE_THINKING_DISPLAY_MIN_VERSION),
        Some(Ordering::Equal | Ordering::Greater)
    )
}

fn claude_mode_args(mode: ClaudePermissionMode) -> &'static [&'static str] {
    match mode {
        ClaudePermissionMode::Default => &[],
        ClaudePermissionMode::Plan => &["--permission-mode", "plan"],
        ClaudePermissionMode::Supervised => &["--permission-mode", "default"],
        ClaudePermissionMode::AcceptEdits => &["--permission-mode", "acceptEdits"],
        ClaudePermissionMode::Auto => &["--permission-mode", "auto"],
        ClaudePermissionMode::BypassPermissions => &["--dangerously-skip-permissions"],
    }
}

fn codex_model_args(model: CodexModelChoice) -> &'static [&'static str] {
    match model {
        CodexModelChoice::Default => &[],
        CodexModelChoice::Gpt6Astra => &["-m", "gpt-6-astra"],
        CodexModelChoice::Gpt56Sol => &["-m", "gpt-5.6-sol"],
        CodexModelChoice::Gpt56Terra => &["-m", "gpt-5.6-terra"],
        CodexModelChoice::Gpt56Luna => &["-m", "gpt-5.6-luna"],
        CodexModelChoice::Gpt55 => &["-m", "gpt-5.5"],
        CodexModelChoice::Gpt54 => &["-m", "gpt-5.4"],
    }
}

fn codex_mode_args(mode: CodexExecutionMode, resumed: bool) -> &'static [&'static str] {
    match (mode, resumed) {
        (CodexExecutionMode::Default, _) => &[],
        (CodexExecutionMode::ReadOnly, false) => &["--sandbox", "read-only"],
        (CodexExecutionMode::ReadOnly, true) => &["-c", "sandbox_mode=\"read-only\""],
        (CodexExecutionMode::WorkspaceWrite, false) => &["--sandbox", "workspace-write"],
        (CodexExecutionMode::WorkspaceWrite, true) => &["-c", "sandbox_mode=\"workspace-write\""],
        (CodexExecutionMode::Auto, false) => &["--sandbox", "workspace-write"],
        (CodexExecutionMode::Auto, true) => &["-c", "sandbox_mode=\"workspace-write\""],
        (CodexExecutionMode::DangerFullAccess, _) => {
            &["--dangerously-bypass-approvals-and-sandbox"]
        }
    }
}

#[cfg(test)]
#[path = "agent_launch_tests.rs"]
mod tests;
