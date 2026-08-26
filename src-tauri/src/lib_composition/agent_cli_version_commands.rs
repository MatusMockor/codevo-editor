use crate::run_blocking_command;
use agent_cli_version::{
    now_epoch_ms, AgentCliVersionProbeRequest, AgentCliVersionProbeResult, AgentCliVersionRegistry,
};
use std::sync::Arc;
use tauri::State;

#[path = "../agent_cli_version.rs"]
pub(crate) mod agent_cli_version;

#[tauri::command]
pub(crate) async fn probe_agent_cli_version(
    request: AgentCliVersionProbeRequest,
    registry: State<'_, Arc<AgentCliVersionRegistry>>,
) -> Result<AgentCliVersionProbeResult, String> {
    let registry = Arc::clone(&registry);
    run_blocking_command(move || registry.probe(&request, now_epoch_ms())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_cli_version::AgentCliBinaryFingerprint;
    use serde_json::json;

    #[test]
    fn the_probe_request_accepts_only_the_closed_camel_case_wire_shape() {
        let accepted = serde_json::from_value::<AgentCliVersionProbeRequest>(json!({
            "agentCliPath": "/usr/local/bin/claude",
            "agentCliKind": "claudeCode"
        }))
        .expect("deserialize probe request");
        let codex = serde_json::from_value::<AgentCliVersionProbeRequest>(json!({
            "agentCliPath": "/usr/local/bin/codex",
            "agentCliKind": "codex"
        }))
        .expect("deserialize codex probe request");
        let unknown_field = serde_json::from_value::<AgentCliVersionProbeRequest>(json!({
            "agentCliPath": "/usr/local/bin/claude",
            "agentCliKind": "claudeCode",
            "extra": 1
        }));
        let snake_case = serde_json::from_value::<AgentCliVersionProbeRequest>(json!({
            "agent_cli_path": "/usr/local/bin/claude",
            "agent_cli_kind": "claudeCode"
        }));
        let unknown_kind = serde_json::from_value::<AgentCliVersionProbeRequest>(json!({
            "agentCliPath": "/usr/local/bin/claude",
            "agentCliKind": "geminiCli"
        }));

        assert_eq!(accepted.agent_cli_path, "/usr/local/bin/claude");
        assert_eq!(
            accepted.agent_cli_kind,
            crate::agent_task_spawner::AgentCliInvocation::ClaudeCode
        );
        assert_eq!(
            codex.agent_cli_kind,
            crate::agent_task_spawner::AgentCliInvocation::CodexExec
        );
        assert!(unknown_field.is_err(), "unknown field must be rejected");
        assert!(snake_case.is_err(), "snake_case keys must be rejected");
        assert!(unknown_kind.is_err(), "unknown provider must be rejected");
    }

    #[test]
    fn the_probe_result_uses_the_camel_case_wire_shape() {
        let result = AgentCliVersionProbeResult {
            version: Some("2.1.245".to_string()),
            probed_at_epoch_ms: 1_700_000_000_000,
            binary_fingerprint: AgentCliBinaryFingerprint {
                size_bytes: 4096,
                modified_epoch_ms: 1_699_000_000_000,
            },
        };

        let encoded = serde_json::to_value(&result).expect("serialize probe result");

        assert_eq!(
            encoded,
            json!({
                "version": "2.1.245",
                "probedAtEpochMs": 1_700_000_000_000u64,
                "binaryFingerprint": {
                    "sizeBytes": 4096,
                    "modifiedEpochMs": 1_699_000_000_000u64
                }
            })
        );
    }

    #[test]
    fn an_unresolved_version_still_serializes_the_fingerprint() {
        let result = AgentCliVersionProbeResult {
            version: None,
            probed_at_epoch_ms: 1,
            binary_fingerprint: AgentCliBinaryFingerprint {
                size_bytes: 0,
                modified_epoch_ms: 0,
            },
        };

        let encoded = serde_json::to_value(&result).expect("serialize probe result");

        assert_eq!(
            encoded,
            json!({
                "version": null,
                "probedAtEpochMs": 1,
                "binaryFingerprint": { "sizeBytes": 0, "modifiedEpochMs": 0 }
            })
        );
    }
}
