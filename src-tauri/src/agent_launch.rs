use serde::{Deserialize, Serialize};

use crate::agent_task_spawner::AgentCliInvocation;

pub const AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR: &str =
    "Agent launch options do not match the agent CLI kind.";
pub const AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR: &str =
    "Agent launch options include a capability the selected model does not support.";

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeModelChoice {
    #[default]
    Default,
    Fable,
    Opus,
    Sonnet,
    #[serde(rename = "claude-fable-5-1")]
    ClaudeFable51,
    #[serde(rename = "claude-fable-5")]
    ClaudeFable5,
    #[serde(rename = "claude-opus-5")]
    ClaudeOpus5,
    #[serde(rename = "claude-opus-4-8")]
    ClaudeOpus48,
    #[serde(rename = "claude-opus-4-7")]
    ClaudeOpus47,
    #[serde(rename = "claude-opus-4-6")]
    ClaudeOpus46,
    #[serde(rename = "claude-opus-4-5")]
    ClaudeOpus45,
    #[serde(rename = "claude-sonnet-5")]
    ClaudeSonnet5,
    #[serde(rename = "claude-sonnet-4-6")]
    ClaudeSonnet46,
    #[serde(rename = "claude-haiku-4-5")]
    ClaudeHaiku45,
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
        }
    }
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
        if let Self::ClaudeCode {
            model,
            effort,
            fast_mode,
            thinking_mode,
            ..
        } = self
        {
            if !claude_model_supports_effort(*model, *effort)
                || (*fast_mode && !claude_model_supports_fast_mode(*model))
                || (*thinking_mode && *model != ClaudeModelChoice::ClaudeHaiku45)
            {
                return Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR);
            }
        }
        Ok(())
    }

    pub fn model_args(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { model, context, .. } => claude_model_args(*model, *context),
            Self::Codex { model, .. } => codex_model_args(*model),
        }
    }

    pub fn mode_args(&self, resumed: bool) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { mode, .. } => claude_mode_args(*mode),
            Self::Codex { mode, .. } => codex_mode_args(*mode, resumed),
        }
    }

    pub fn effort_args(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { effort, .. } => claude_effort_args(*effort),
            Self::Codex { .. } => &[],
        }
    }

    pub fn settings_args(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode {
                model: ClaudeModelChoice::ClaudeHaiku45,
                thinking_mode: true,
                ..
            } => &["--settings", r#"{"alwaysThinkingEnabled":true}"#],
            Self::ClaudeCode {
                model: ClaudeModelChoice::ClaudeHaiku45,
                thinking_mode: false,
                ..
            } => &["--settings", r#"{"alwaysThinkingEnabled":false}"#],
            Self::ClaudeCode {
                effort: ClaudeEffortChoice::Ultracode,
                fast_mode: true,
                ..
            } => &["--settings", r#"{"fastMode":true,"ultracode":true}"#],
            Self::ClaudeCode {
                effort: ClaudeEffortChoice::Ultracode,
                ..
            } => &["--settings", r#"{"ultracode":true}"#],
            Self::ClaudeCode {
                fast_mode: true, ..
            } => &["--settings", r#"{"fastMode":true}"#],
            _ => &[],
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

fn claude_model_supports_fast_mode(model: ClaudeModelChoice) -> bool {
    matches!(
        model,
        ClaudeModelChoice::Opus
            | ClaudeModelChoice::ClaudeOpus5
            | ClaudeModelChoice::ClaudeOpus48
            | ClaudeModelChoice::ClaudeOpus47
            | ClaudeModelChoice::ClaudeOpus46
            | ClaudeModelChoice::ClaudeOpus45
    )
}

fn claude_model_supports_effort(model: ClaudeModelChoice, effort: ClaudeEffortChoice) -> bool {
    match effort {
        ClaudeEffortChoice::Default | ClaudeEffortChoice::Low | ClaudeEffortChoice::Medium => {
            model != ClaudeModelChoice::ClaudeHaiku45 || effort == ClaudeEffortChoice::Default
        }
        ClaudeEffortChoice::High => model != ClaudeModelChoice::ClaudeHaiku45,
        ClaudeEffortChoice::Xhigh => matches!(
            model,
            ClaudeModelChoice::Default
                | ClaudeModelChoice::Fable
                | ClaudeModelChoice::Opus
                | ClaudeModelChoice::Sonnet
                | ClaudeModelChoice::ClaudeFable51
                | ClaudeModelChoice::ClaudeFable5
                | ClaudeModelChoice::ClaudeOpus5
                | ClaudeModelChoice::ClaudeOpus48
                | ClaudeModelChoice::ClaudeOpus47
                | ClaudeModelChoice::ClaudeSonnet5
        ),
        ClaudeEffortChoice::Max => model != ClaudeModelChoice::ClaudeHaiku45,
        ClaudeEffortChoice::Ultracode => matches!(
            model,
            ClaudeModelChoice::Fable
                | ClaudeModelChoice::Opus
                | ClaudeModelChoice::ClaudeFable51
                | ClaudeModelChoice::ClaudeFable5
                | ClaudeModelChoice::ClaudeOpus5
                | ClaudeModelChoice::ClaudeOpus48
        ),
        ClaudeEffortChoice::Ultrathink => !matches!(
            model,
            ClaudeModelChoice::ClaudeOpus45 | ClaudeModelChoice::ClaudeHaiku45
        ),
    }
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
) -> &'static [&'static str] {
    match (model, context) {
        (ClaudeModelChoice::Default, _) => &[],
        (ClaudeModelChoice::Fable, ClaudeContextChoice::TwoHundredK) => &["--model", "fable"],
        (ClaudeModelChoice::Fable, ClaudeContextChoice::OneM) => &["--model", "fable[1m]"],
        (ClaudeModelChoice::Opus, ClaudeContextChoice::TwoHundredK) => &["--model", "opus"],
        (ClaudeModelChoice::Opus, ClaudeContextChoice::OneM) => &["--model", "opus[1m]"],
        (ClaudeModelChoice::Sonnet, ClaudeContextChoice::TwoHundredK) => &["--model", "sonnet"],
        (ClaudeModelChoice::Sonnet, ClaudeContextChoice::OneM) => &["--model", "sonnet[1m]"],
        (ClaudeModelChoice::ClaudeFable51, ClaudeContextChoice::TwoHundredK) => {
            &["--model", "claude-fable-5-1"]
        }
        (ClaudeModelChoice::ClaudeFable51, ClaudeContextChoice::OneM) => {
            &["--model", "claude-fable-5-1[1m]"]
        }
        (ClaudeModelChoice::ClaudeFable5, ClaudeContextChoice::TwoHundredK) => {
            &["--model", "claude-fable-5"]
        }
        (ClaudeModelChoice::ClaudeFable5, ClaudeContextChoice::OneM) => {
            &["--model", "claude-fable-5[1m]"]
        }
        (ClaudeModelChoice::ClaudeOpus5, ClaudeContextChoice::TwoHundredK) => {
            &["--model", "claude-opus-5"]
        }
        (ClaudeModelChoice::ClaudeOpus5, ClaudeContextChoice::OneM) => {
            &["--model", "claude-opus-5[1m]"]
        }
        (ClaudeModelChoice::ClaudeOpus48, _) => &["--model", "claude-opus-4-8"],
        (ClaudeModelChoice::ClaudeOpus47, _) => &["--model", "claude-opus-4-7"],
        (ClaudeModelChoice::ClaudeOpus46, ClaudeContextChoice::TwoHundredK) => {
            &["--model", "claude-opus-4-6"]
        }
        (ClaudeModelChoice::ClaudeOpus46, ClaudeContextChoice::OneM) => {
            &["--model", "claude-opus-4-6[1m]"]
        }
        (ClaudeModelChoice::ClaudeOpus45, _) => &["--model", "claude-opus-4-5"],
        (ClaudeModelChoice::ClaudeSonnet5, ClaudeContextChoice::TwoHundredK) => {
            &["--model", "claude-sonnet-5"]
        }
        (ClaudeModelChoice::ClaudeSonnet5, ClaudeContextChoice::OneM) => {
            &["--model", "claude-sonnet-5[1m]"]
        }
        (ClaudeModelChoice::ClaudeSonnet46, ClaudeContextChoice::TwoHundredK) => {
            &["--model", "claude-sonnet-4-6"]
        }
        (ClaudeModelChoice::ClaudeSonnet46, ClaudeContextChoice::OneM) => {
            &["--model", "claude-sonnet-4-6[1m]"]
        }
        (ClaudeModelChoice::ClaudeHaiku45, _) => &["--model", "claude-haiku-4-5"],
    }
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
mod tests {
    use super::*;

    const CLAUDE_MODELS: [ClaudeModelChoice; 14] = [
        ClaudeModelChoice::Default,
        ClaudeModelChoice::Fable,
        ClaudeModelChoice::Opus,
        ClaudeModelChoice::Sonnet,
        ClaudeModelChoice::ClaudeFable51,
        ClaudeModelChoice::ClaudeFable5,
        ClaudeModelChoice::ClaudeOpus5,
        ClaudeModelChoice::ClaudeOpus48,
        ClaudeModelChoice::ClaudeOpus47,
        ClaudeModelChoice::ClaudeOpus46,
        ClaudeModelChoice::ClaudeOpus45,
        ClaudeModelChoice::ClaudeSonnet5,
        ClaudeModelChoice::ClaudeSonnet46,
        ClaudeModelChoice::ClaudeHaiku45,
    ];
    const CLAUDE_MODES: [ClaudePermissionMode; 6] = [
        ClaudePermissionMode::Default,
        ClaudePermissionMode::Plan,
        ClaudePermissionMode::Supervised,
        ClaudePermissionMode::AcceptEdits,
        ClaudePermissionMode::Auto,
        ClaudePermissionMode::BypassPermissions,
    ];
    const CODEX_MODELS: [CodexModelChoice; 7] = [
        CodexModelChoice::Default,
        CodexModelChoice::Gpt6Astra,
        CodexModelChoice::Gpt56Sol,
        CodexModelChoice::Gpt56Terra,
        CodexModelChoice::Gpt56Luna,
        CodexModelChoice::Gpt55,
        CodexModelChoice::Gpt54,
    ];
    const CODEX_MODES: [CodexExecutionMode; 5] = [
        CodexExecutionMode::Default,
        CodexExecutionMode::ReadOnly,
        CodexExecutionMode::WorkspaceWrite,
        CodexExecutionMode::Auto,
        CodexExecutionMode::DangerFullAccess,
    ];

    const CLAUDE_EFFORTS: [ClaudeEffortChoice; 8] = [
        ClaudeEffortChoice::Default,
        ClaudeEffortChoice::Low,
        ClaudeEffortChoice::Medium,
        ClaudeEffortChoice::High,
        ClaudeEffortChoice::Xhigh,
        ClaudeEffortChoice::Max,
        ClaudeEffortChoice::Ultracode,
        ClaudeEffortChoice::Ultrathink,
    ];

    fn claude(model: ClaudeModelChoice, mode: ClaudePermissionMode) -> AgentLaunchOptions {
        claude_with_effort(model, mode, ClaudeEffortChoice::Default)
    }

    fn claude_with_effort(
        model: ClaudeModelChoice,
        mode: ClaudePermissionMode,
        effort: ClaudeEffortChoice,
    ) -> AgentLaunchOptions {
        AgentLaunchOptions::ClaudeCode {
            model,
            mode,
            effort,
            context: ClaudeContextChoice::TwoHundredK,
            fast_mode: false,
            thinking_mode: false,
        }
    }

    fn codex(model: CodexModelChoice, mode: CodexExecutionMode) -> AgentLaunchOptions {
        AgentLaunchOptions::Codex { model, mode }
    }

    #[test]
    fn product_default_is_a_concrete_full_access_claude_launch() {
        let options = AgentLaunchOptions::default();
        assert!(options.is_dangerous());
        assert_eq!(options.mode_args(false), ["--dangerously-skip-permissions"]);
        assert_eq!(options.effort_args(), ["--effort", "high"]);
        assert!(options.model_args().is_empty());
    }

    #[test]
    fn claude_model_table_is_exhaustive_and_flagless_by_default() {
        let expected: [&[&str]; 14] = [
            &[],
            &["--model", "fable"],
            &["--model", "opus"],
            &["--model", "sonnet"],
            &["--model", "claude-fable-5-1"],
            &["--model", "claude-fable-5"],
            &["--model", "claude-opus-5"],
            &["--model", "claude-opus-4-8"],
            &["--model", "claude-opus-4-7"],
            &["--model", "claude-opus-4-6"],
            &["--model", "claude-opus-4-5"],
            &["--model", "claude-sonnet-5"],
            &["--model", "claude-sonnet-4-6"],
            &["--model", "claude-haiku-4-5"],
        ];
        for (index, model) in CLAUDE_MODELS.into_iter().enumerate() {
            assert_eq!(
                claude(model, ClaudePermissionMode::Default).model_args(),
                expected[index],
                "model {model:?}"
            );
        }
    }

    #[test]
    fn claude_one_million_context_uses_the_runtime_model_suffix() {
        let launch = AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Fable,
            mode: ClaudePermissionMode::Default,
            effort: ClaudeEffortChoice::High,
            context: ClaudeContextChoice::OneM,
            fast_mode: false,
            thinking_mode: false,
        };
        assert_eq!(launch.model_args(), &["--model", "fable[1m]"]);
    }

    #[test]
    fn claude_mode_table_is_exhaustive_and_ignores_resume() {
        let expected: [&[&str]; 6] = [
            &[],
            &["--permission-mode", "plan"],
            &["--permission-mode", "default"],
            &["--permission-mode", "acceptEdits"],
            &["--permission-mode", "auto"],
            &["--dangerously-skip-permissions"],
        ];
        for (index, mode) in CLAUDE_MODES.into_iter().enumerate() {
            let options = claude(ClaudeModelChoice::Default, mode);
            assert_eq!(options.mode_args(false), expected[index], "mode {mode:?}");
            assert_eq!(options.mode_args(true), expected[index], "mode {mode:?}");
        }
    }

    #[test]
    fn claude_effort_table_is_exhaustive_and_flagless_by_default() {
        let expected: [&[&str]; 8] = [
            &[],
            &["--effort", "low"],
            &["--effort", "medium"],
            &["--effort", "high"],
            &["--effort", "xhigh"],
            &["--effort", "max"],
            &["--effort", "xhigh"],
            &[],
        ];
        for (index, effort) in CLAUDE_EFFORTS.into_iter().enumerate() {
            let options = claude_with_effort(
                ClaudeModelChoice::Default,
                ClaudePermissionMode::Default,
                effort,
            );
            assert_eq!(options.effort_args(), expected[index], "effort {effort:?}");
        }
    }

    #[test]
    fn claude_ultracode_maps_to_xhigh_and_enables_cli_orchestration() {
        let launch = claude_with_effort(
            ClaudeModelChoice::Opus,
            ClaudePermissionMode::BypassPermissions,
            ClaudeEffortChoice::Ultracode,
        );
        assert_eq!(launch.effort_args(), &["--effort", "xhigh"]);
        assert_eq!(
            launch.settings_args(),
            &["--settings", r#"{"ultracode":true}"#]
        );
    }

    #[test]
    fn claude_fast_mode_is_forwarded_with_ultracode_in_one_settings_document() {
        let launch = AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Opus,
            mode: ClaudePermissionMode::BypassPermissions,
            effort: ClaudeEffortChoice::Ultracode,
            context: ClaudeContextChoice::OneM,
            fast_mode: true,
            thinking_mode: false,
        };
        assert_eq!(
            launch.settings_args(),
            &["--settings", r#"{"fastMode":true,"ultracode":true}"#]
        );
    }

    #[test]
    fn claude_haiku_thinking_is_forwarded_as_a_real_cli_setting() {
        let launch = AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::ClaudeHaiku45,
            mode: ClaudePermissionMode::BypassPermissions,
            effort: ClaudeEffortChoice::Default,
            context: ClaudeContextChoice::TwoHundredK,
            fast_mode: false,
            thinking_mode: true,
        };
        assert_eq!(
            launch.settings_args(),
            &["--settings", r#"{"alwaysThinkingEnabled":true}"#]
        );
        assert!(launch.validate_capabilities().is_ok());
    }

    #[test]
    fn claude_ultrathink_prefixes_prose_but_preserves_cli_slash_commands() {
        let launch = claude_with_effort(
            ClaudeModelChoice::Fable,
            ClaudePermissionMode::BypassPermissions,
            ClaudeEffortChoice::Ultrathink,
        );
        assert_eq!(
            launch.prompt("Investigate this"),
            "Ultrathink:\nInvestigate this"
        );
        assert_eq!(
            launch.prompt(" /compact keep recent errors "),
            "/compact keep recent errors"
        );
        assert_eq!(
            launch.prompt("/home/developer/app.ts failed"),
            "Ultrathink:\n/home/developer/app.ts failed"
        );
    }

    #[test]
    fn model_specific_capabilities_fail_closed() {
        let unsupported_ultracode = claude_with_effort(
            ClaudeModelChoice::Sonnet,
            ClaudePermissionMode::BypassPermissions,
            ClaudeEffortChoice::Ultracode,
        );
        assert_eq!(
            unsupported_ultracode.validate_capabilities(),
            Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
        );

        let unsupported_fast = AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Fable,
            mode: ClaudePermissionMode::BypassPermissions,
            effort: ClaudeEffortChoice::High,
            context: ClaudeContextChoice::OneM,
            fast_mode: true,
            thinking_mode: false,
        };
        assert_eq!(
            unsupported_fast.validate_capabilities(),
            Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
        );
        assert!(AgentLaunchOptions::ClaudeCode {
            model: ClaudeModelChoice::Opus,
            mode: ClaudePermissionMode::BypassPermissions,
            effort: ClaudeEffortChoice::High,
            context: ClaudeContextChoice::OneM,
            fast_mode: true,
            thinking_mode: false,
        }
        .validate_capabilities()
        .is_ok());
        assert_eq!(
            claude_with_effort(
                ClaudeModelChoice::ClaudeHaiku45,
                ClaudePermissionMode::BypassPermissions,
                ClaudeEffortChoice::High,
            )
            .validate_capabilities(),
            Err(AGENT_LAUNCH_CAPABILITY_MISMATCH_ERROR)
        );
    }

    #[test]
    fn codex_never_carries_effort_args() {
        for model in CODEX_MODELS {
            for mode in CODEX_MODES {
                assert!(codex(model, mode).effort_args().is_empty());
            }
        }
    }

    #[test]
    fn claude_launch_defaults_effort_when_the_stored_document_omits_it() {
        let decoded: AgentLaunchOptions =
            serde_json::from_str(r#"{"provider":"claudeCode","model":"sonnet","mode":"plan"}"#)
                .expect("schema 1 claude launch decodes");
        assert_eq!(
            decoded,
            claude_with_effort(
                ClaudeModelChoice::Sonnet,
                ClaudePermissionMode::Plan,
                ClaudeEffortChoice::Default
            )
        );
        assert!(decoded.effort_args().is_empty());
    }

    #[test]
    fn codex_model_table_is_exhaustive_and_flagless_by_default() {
        let expected: [&[&str]; 7] = [
            &[],
            &["-m", "gpt-6-astra"],
            &["-m", "gpt-5.6-sol"],
            &["-m", "gpt-5.6-terra"],
            &["-m", "gpt-5.6-luna"],
            &["-m", "gpt-5.5"],
            &["-m", "gpt-5.4"],
        ];
        for (index, model) in CODEX_MODELS.into_iter().enumerate() {
            assert_eq!(
                codex(model, CodexExecutionMode::Default).model_args(),
                expected[index],
                "model {model:?}"
            );
        }
    }

    #[test]
    fn codex_mode_table_differs_between_first_turn_and_resume() {
        let first: [&[&str]; 5] = [
            &[],
            &["--sandbox", "read-only"],
            &["--sandbox", "workspace-write"],
            &["--sandbox", "workspace-write"],
            &["--dangerously-bypass-approvals-and-sandbox"],
        ];
        let resumed: [&[&str]; 5] = [
            &[],
            &["-c", "sandbox_mode=\"read-only\""],
            &["-c", "sandbox_mode=\"workspace-write\""],
            &["-c", "sandbox_mode=\"workspace-write\""],
            &["--dangerously-bypass-approvals-and-sandbox"],
        ];
        for (index, mode) in CODEX_MODES.into_iter().enumerate() {
            let options = codex(CodexModelChoice::Default, mode);
            assert_eq!(options.mode_args(false), first[index], "mode {mode:?}");
            assert_eq!(options.mode_args(true), resumed[index], "mode {mode:?}");
        }
    }

    #[test]
    fn invocation_and_dangerous_classification_follow_the_provider() {
        assert_eq!(
            claude(ClaudeModelChoice::Opus, ClaudePermissionMode::Plan).invocation(),
            AgentCliInvocation::ClaudeCode
        );
        assert_eq!(
            codex(CodexModelChoice::Gpt55, CodexExecutionMode::ReadOnly).invocation(),
            AgentCliInvocation::CodexExec
        );
        assert!(claude(
            ClaudeModelChoice::Default,
            ClaudePermissionMode::BypassPermissions
        )
        .is_dangerous());
        assert!(codex(
            CodexModelChoice::Default,
            CodexExecutionMode::DangerFullAccess
        )
        .is_dangerous());
        assert!(!claude(
            ClaudeModelChoice::Default,
            ClaudePermissionMode::AcceptEdits
        )
        .is_dangerous());
        assert!(!codex(
            CodexModelChoice::Default,
            CodexExecutionMode::WorkspaceWrite
        )
        .is_dangerous());
    }

    #[test]
    fn matches_only_its_own_invocation() {
        let options = codex(CodexModelChoice::Gpt54, CodexExecutionMode::Default);
        assert!(options.matches(AgentCliInvocation::CodexExec));
        assert!(!options.matches(AgentCliInvocation::ClaudeCode));
    }

    #[test]
    fn serde_round_trips_every_pair() {
        for model in CLAUDE_MODELS {
            for mode in CLAUDE_MODES {
                let options = claude(model, mode);
                let encoded = serde_json::to_string(&options).expect("claude launch encodes");
                let decoded: AgentLaunchOptions =
                    serde_json::from_str(&encoded).expect("claude launch decodes");
                assert_eq!(decoded, options);
            }
        }
        for model in CODEX_MODELS {
            for mode in CODEX_MODES {
                let options = codex(model, mode);
                let encoded = serde_json::to_string(&options).expect("codex launch encodes");
                let decoded: AgentLaunchOptions =
                    serde_json::from_str(&encoded).expect("codex launch decodes");
                assert_eq!(decoded, options);
            }
        }
    }

    #[test]
    fn serde_uses_the_documented_wire_names() {
        let astra_wire = r#"{"provider":"codex","model":"gpt-6-astra","mode":"workspaceWrite"}"#;
        let astra = codex(
            CodexModelChoice::Gpt6Astra,
            CodexExecutionMode::WorkspaceWrite,
        );
        assert_eq!(
            serde_json::from_str::<AgentLaunchOptions>(astra_wire).expect("astra launch decodes"),
            astra
        );
        assert_eq!(
            serde_json::to_string(&astra).expect("astra launch encodes"),
            astra_wire
        );
        let encoded = serde_json::to_string(&codex(
            CodexModelChoice::Gpt56Sol,
            CodexExecutionMode::WorkspaceWrite,
        ))
        .expect("codex launch encodes");
        assert_eq!(
            encoded,
            r#"{"provider":"codex","model":"gpt-5.6-sol","mode":"workspaceWrite"}"#
        );
        let encoded = serde_json::to_string(&claude(
            ClaudeModelChoice::Sonnet,
            ClaudePermissionMode::BypassPermissions,
        ))
        .expect("claude launch encodes");
        assert_eq!(
            encoded,
            r#"{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"default","context":"200k"}"#
        );
        let encoded = serde_json::to_string(&claude_with_effort(
            ClaudeModelChoice::Sonnet,
            ClaudePermissionMode::BypassPermissions,
            ClaudeEffortChoice::Xhigh,
        ))
        .expect("claude launch encodes");
        assert_eq!(
            encoded,
            r#"{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"xhigh","context":"200k"}"#
        );
    }

    #[test]
    fn serde_rejects_unknown_variants_fields_and_cross_provider_pairs() {
        for model in ["gpt-6-astra-unknown", "gpt-6-astra --help", "gpt-6"] {
            let wire = serde_json::json!({"provider": "codex", "model": model, "mode": "default"});
            assert!(serde_json::from_value::<AgentLaunchOptions>(wire).is_err());
        }
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"claudeCode","model":"claude-opus-4","mode":"default"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"gemini","model":"default","mode":"default"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"codex","model":"default","mode":"acceptEdits"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"claudeCode","model":"default","mode":"readOnly"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"codex","model":"default","mode":"default","effort":"high"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"codex","model":"default"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"claudeCode","model":"default","mode":"default","effort":"ultra"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"codex","model":"default","mode":"default","effort":"low"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"codex","model":"default","mode":"default","effort":"default"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<AgentLaunchOptions>(
            r#"{"provider":"claudeCode","model":"default","mode":"default","effort":"Xhigh"}"#
        )
        .is_err());
    }
}
