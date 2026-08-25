use serde::{Deserialize, Serialize};

use crate::agent_task_spawner::AgentCliInvocation;

pub const AGENT_LAUNCH_PROVIDER_MISMATCH_ERROR: &str =
    "Agent launch options do not match the agent CLI kind.";

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudeModelChoice {
    #[default]
    Default,
    Fable,
    Opus,
    Sonnet,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClaudePermissionMode {
    #[default]
    Default,
    Plan,
    AcceptEdits,
    BypassPermissions,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
pub enum CodexModelChoice {
    #[default]
    #[serde(rename = "default")]
    Default,
    #[serde(rename = "gpt-5.6-sol")]
    Gpt56Sol,
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
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CodexExecutionMode {
    #[default]
    Default,
    ReadOnly,
    WorkspaceWrite,
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
            mode: ClaudePermissionMode::Default,
            effort: ClaudeEffortChoice::Default,
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

    pub fn model_args(&self) -> &'static [&'static str] {
        match self {
            Self::ClaudeCode { model, .. } => claude_model_args(*model),
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
}

fn claude_effort_args(effort: ClaudeEffortChoice) -> &'static [&'static str] {
    match effort {
        ClaudeEffortChoice::Default => &[],
        ClaudeEffortChoice::Low => &["--effort", "low"],
        ClaudeEffortChoice::Medium => &["--effort", "medium"],
        ClaudeEffortChoice::High => &["--effort", "high"],
        ClaudeEffortChoice::Xhigh => &["--effort", "xhigh"],
        ClaudeEffortChoice::Max => &["--effort", "max"],
    }
}

fn claude_model_args(model: ClaudeModelChoice) -> &'static [&'static str] {
    match model {
        ClaudeModelChoice::Default => &[],
        ClaudeModelChoice::Fable => &["--model", "fable"],
        ClaudeModelChoice::Opus => &["--model", "opus"],
        ClaudeModelChoice::Sonnet => &["--model", "sonnet"],
    }
}

fn claude_mode_args(mode: ClaudePermissionMode) -> &'static [&'static str] {
    match mode {
        ClaudePermissionMode::Default => &[],
        ClaudePermissionMode::Plan => &["--permission-mode", "plan"],
        ClaudePermissionMode::AcceptEdits => &["--permission-mode", "acceptEdits"],
        ClaudePermissionMode::BypassPermissions => &["--dangerously-skip-permissions"],
    }
}

fn codex_model_args(model: CodexModelChoice) -> &'static [&'static str] {
    match model {
        CodexModelChoice::Default => &[],
        CodexModelChoice::Gpt56Sol => &["-m", "gpt-5.6-sol"],
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
        (CodexExecutionMode::DangerFullAccess, _) => {
            &["--dangerously-bypass-approvals-and-sandbox"]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE_MODELS: [ClaudeModelChoice; 4] = [
        ClaudeModelChoice::Default,
        ClaudeModelChoice::Fable,
        ClaudeModelChoice::Opus,
        ClaudeModelChoice::Sonnet,
    ];
    const CLAUDE_MODES: [ClaudePermissionMode; 4] = [
        ClaudePermissionMode::Default,
        ClaudePermissionMode::Plan,
        ClaudePermissionMode::AcceptEdits,
        ClaudePermissionMode::BypassPermissions,
    ];
    const CODEX_MODELS: [CodexModelChoice; 4] = [
        CodexModelChoice::Default,
        CodexModelChoice::Gpt56Sol,
        CodexModelChoice::Gpt55,
        CodexModelChoice::Gpt54,
    ];
    const CODEX_MODES: [CodexExecutionMode; 4] = [
        CodexExecutionMode::Default,
        CodexExecutionMode::ReadOnly,
        CodexExecutionMode::WorkspaceWrite,
        CodexExecutionMode::DangerFullAccess,
    ];

    const CLAUDE_EFFORTS: [ClaudeEffortChoice; 6] = [
        ClaudeEffortChoice::Default,
        ClaudeEffortChoice::Low,
        ClaudeEffortChoice::Medium,
        ClaudeEffortChoice::High,
        ClaudeEffortChoice::Xhigh,
        ClaudeEffortChoice::Max,
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
        }
    }

    fn codex(model: CodexModelChoice, mode: CodexExecutionMode) -> AgentLaunchOptions {
        AgentLaunchOptions::Codex { model, mode }
    }

    #[test]
    fn claude_model_table_is_exhaustive_and_flagless_by_default() {
        let expected: [&[&str]; 4] = [
            &[],
            &["--model", "fable"],
            &["--model", "opus"],
            &["--model", "sonnet"],
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
    fn claude_mode_table_is_exhaustive_and_ignores_resume() {
        let expected: [&[&str]; 4] = [
            &[],
            &["--permission-mode", "plan"],
            &["--permission-mode", "acceptEdits"],
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
        let expected: [&[&str]; 6] = [
            &[],
            &["--effort", "low"],
            &["--effort", "medium"],
            &["--effort", "high"],
            &["--effort", "xhigh"],
            &["--effort", "max"],
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
        let expected: [&[&str]; 4] = [
            &[],
            &["-m", "gpt-5.6-sol"],
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
        let first: [&[&str]; 4] = [
            &[],
            &["--sandbox", "read-only"],
            &["--sandbox", "workspace-write"],
            &["--dangerously-bypass-approvals-and-sandbox"],
        ];
        let resumed: [&[&str]; 4] = [
            &[],
            &["-c", "sandbox_mode=\"read-only\""],
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
            r#"{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"default"}"#
        );
        let encoded = serde_json::to_string(&claude_with_effort(
            ClaudeModelChoice::Sonnet,
            ClaudePermissionMode::BypassPermissions,
            ClaudeEffortChoice::Xhigh,
        ))
        .expect("claude launch encodes");
        assert_eq!(
            encoded,
            r#"{"provider":"claudeCode","model":"sonnet","mode":"bypassPermissions","effort":"xhigh"}"#
        );
    }

    #[test]
    fn serde_rejects_unknown_variants_fields_and_cross_provider_pairs() {
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
