use crate::agent_cli_discovery::{AgentCliDiscovery, AgentCliDiscoveryResult};
use crate::run_blocking_command;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct DiscoverAgentClisRequest {
    refresh: bool,
}

#[tauri::command]
pub(crate) async fn discover_agent_clis(
    request: DiscoverAgentClisRequest,
    discovery: State<'_, Arc<AgentCliDiscovery>>,
) -> Result<AgentCliDiscoveryResult, String> {
    let discovery = Arc::clone(&discovery);
    run_blocking_command(move || discover_agent_clis_blocking(&discovery, request)).await
}

fn discover_agent_clis_blocking(
    discovery: &AgentCliDiscovery,
    request: DiscoverAgentClisRequest,
) -> Result<AgentCliDiscoveryResult, String> {
    if request.refresh {
        return discovery
            .refresh()
            .map(|environment| environment.presentation())
            .map_err(|error| error.to_string());
    }
    discovery
        .effective_environment()
        .map(|environment| environment.presentation())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn discovery_request_accepts_only_the_exact_refresh_shape() {
        let request = serde_json::from_value::<DiscoverAgentClisRequest>(json!({
            "refresh": true
        }))
        .expect("deserialize request");

        assert!(request.refresh);
        assert!(serde_json::from_value::<DiscoverAgentClisRequest>(json!({})).is_err());
        assert!(serde_json::from_value::<DiscoverAgentClisRequest>(json!({
            "refresh": false,
            "path": "/tmp/claude"
        }))
        .is_err());
        assert!(serde_json::from_value::<DiscoverAgentClisRequest>(json!({
            "refresh": "yes"
        }))
        .is_err());
    }

    #[test]
    fn discovery_result_serializes_as_the_closed_camel_case_wire_contract() {
        let result = AgentCliDiscoveryResult {
            claude_code: crate::agent_cli_discovery::AgentCliDiscoveryState::Detected {
                path: "/usr/local/bin/claude".to_string(),
                version: Some("2.1.247".to_string()),
                configured_model: Some("claude-fable-5-1[1m]".to_string()),
            },
            codex: crate::agent_cli_discovery::AgentCliDiscoveryState::NotFound,
        };

        assert_eq!(
            serde_json::to_value(result).expect("serialize result"),
            json!({
                "claudeCode": {
                    "kind": "detected",
                    "path": "/usr/local/bin/claude",
                    "version": "2.1.247",
                    "configuredModel": "claude-fable-5-1[1m]"
                },
                "codex": { "kind": "notFound" }
            })
        );
    }
}
