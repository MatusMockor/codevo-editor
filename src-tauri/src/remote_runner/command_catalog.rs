//! Provider slash-command catalog from the exact selected runner for a server-hosted project.
use super::{
    commands::blocking, project_management::call_lease, service::RemoteRunnerState, types::id,
};
use crate::agent_command_catalog_domain::{parse_foreign_catalog, AgentCommandCatalog};
use crate::agent_task_spawner::AgentCliInvocation;
use serde::Deserialize;
use serde_json::Value;

const INVALID: &str = "Invalid runner command catalog";
const UNSUPPORTED: &str =
    "The server runner does not support command catalogs. Update the runner on the server.";
const CHANGED: &str = "Server connection changed during request";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandCatalogRequest {
    server_id: String,
    runner_id: String,
    project_id: String,
    provider: Provider,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum Provider {
    Claude,
    Codex,
}
impl Provider {
    fn segment(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
        }
    }
    fn catalog_provider(self) -> AgentCliInvocation {
        match self {
            Self::Claude => AgentCliInvocation::ClaudeCode,
            Self::Codex => AgentCliInvocation::CodexExec,
        }
    }
}
impl CommandCatalogRequest {
    fn path(&self) -> Result<String, String> {
        id(&self.project_id)?;
        Ok(format!(
            "/v1/projects/{}/command-catalog/{}",
            self.project_id,
            self.provider.segment()
        ))
    }
}
fn text(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
fn validate(value: Value, provider: Provider) -> Result<AgentCommandCatalog, String> {
    parse_foreign_catalog(value, provider.catalog_provider()).map_err(|_| INVALID.to_string())
}
fn admit_descriptor(descriptor: Value, expected_runner: &str) -> Result<(), String> {
    if super::descriptor::validate(descriptor.clone())? != expected_runner {
        return Err(CHANGED.into());
    }
    if descriptor
        .get("capabilities")
        .and_then(|caps| caps.get("commandCatalog"))
        .and_then(Value::as_bool)
        != Some(true)
    {
        return Err(UNSUPPORTED.into());
    }
    Ok(())
}
#[tauri::command]
pub async fn remote_runner_get_command_catalog(
    state: tauri::State<'_, RemoteRunnerState>,
    request: CommandCatalogRequest,
) -> Result<AgentCommandCatalog, String> {
    id(&request.server_id)?;
    if !text(&request.runner_id, 128) {
        return Err("Invalid runner identity".into());
    }
    let path = request.path()?;
    let provider = request.provider;
    let lease = state.connection_lease(&request.server_id)?;
    if lease.runner_id() != request.runner_id {
        return Err(CHANGED.into());
    }
    let probe_lease = lease.clone();
    let catalog = blocking(move || {
        let descriptor = call_lease(probe_lease.clone(), "GET", "/v1/runner", None)?;
        admit_descriptor(descriptor, probe_lease.runner_id())?;
        validate(call_lease(probe_lease, "GET", &path, None)?, provider)
    })
    .await?;
    if !lease.is_current() || lease.runner_id() != request.runner_id {
        return Err(CHANGED.into());
    }
    Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CONTRACT: &[u8] = include_bytes!("../../../contracts/agent-command-catalog-wire.json");

    fn contract_cases(key: &str) -> Vec<(String, Value)> {
        let contract: Value = serde_json::from_slice(CONTRACT).unwrap();
        contract[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|case| {
                (
                    case["name"].as_str().unwrap().to_string(),
                    case["value"].clone(),
                )
            })
            .collect()
    }

    fn request(value: Value) -> Result<CommandCatalogRequest, String> {
        let request: CommandCatalogRequest =
            serde_json::from_value(value).map_err(|_| "deserialize".to_string())?;
        id(&request.server_id)?;
        if !text(&request.runner_id, 128) {
            return Err("Invalid runner identity".into());
        }
        request.path()?;
        Ok(request)
    }

    #[test]
    fn contract_remote_requests_are_accepted_and_rejected() {
        for (name, value) in contract_cases("remoteRequests") {
            let request = request(value).expect(&name);
            let segment = match request.provider {
                Provider::Claude => "claude",
                Provider::Codex => "codex",
            };
            assert_eq!(
                request.path().unwrap(),
                format!("/v1/projects/codevo-editor/command-catalog/{segment}"),
                "{name}"
            );
        }
        for (name, value) in contract_cases("rejectedRemoteRequests") {
            assert!(request(value).is_err(), "{name}");
        }
        for project in ["a", "codevo-editor", "a_b-c9", &"x".repeat(64)] {
            assert!(request(json!({"serverId":"server","runnerId":"runner","projectId":project,"provider":"codex"})).is_ok(), "{project}");
        }
        for project in [
            "-a",
            "_a",
            "a.b",
            "a b",
            "a/b",
            "../a",
            "a\n",
            &"x".repeat(65),
        ] {
            assert!(request(json!({"serverId":"server","runnerId":"runner","projectId":project,"provider":"codex"})).is_err(), "{project}");
        }
        assert!(request(
            json!({"serverId":"../x","runnerId":"runner","projectId":"p","provider":"codex"})
        )
        .is_err());
        assert!(request(
            json!({"serverId":"server","runnerId":"run\nner","projectId":"p","provider":"codex"})
        )
        .is_err());
        assert!(request(
            json!({"serverId":"server","runnerId":"runner","projectId":"p","provider":"openai"})
        )
        .is_err());
    }

    #[test]
    fn runner_catalogs_are_validated_strictly_against_the_contract_for_the_requested_provider() {
        for (name, value) in contract_cases("catalogs") {
            let (matching, other) = match value["provider"].as_str().unwrap() {
                "claudeCode" => (Provider::Claude, Provider::Codex),
                _ => (Provider::Codex, Provider::Claude),
            };
            let catalog = validate(value.clone(), matching).expect(&name);
            assert_eq!(serde_json::to_value(&catalog).unwrap(), value, "{name}");
            assert_eq!(
                validate(value, other).err().as_deref(),
                Some(INVALID),
                "{name}"
            );
        }
        for (name, value) in contract_cases("rejectedCatalogs") {
            for provider in [Provider::Claude, Provider::Codex] {
                assert_eq!(
                    validate(value.clone(), provider).err().as_deref(),
                    Some(INVALID),
                    "{name}"
                );
            }
        }
        let entries: Vec<Value> = (0..513)
            .map(|index| json!({"kind":"skill","name":format!("skill-{index}"),"label":null,"description":null,"argumentHint":null,"builtin":false}))
            .collect();
        let oversized = json!({"version":1,"provider":"codex","truncated":true,"entries":entries});
        assert!(validate(oversized, Provider::Codex).is_err());
        let long_name = json!({"version":1,"provider":"codex","truncated":false,"entries":[{"kind":"skill","name":"n".repeat(129),"label":null,"description":null,"argumentHint":null,"builtin":false}]});
        assert!(validate(long_name, Provider::Codex).is_err());
        let long_label = json!({"version":1,"provider":"codex","truncated":false,"entries":[{"kind":"skill","name":"pdf","label":"l".repeat(129),"description":null,"argumentHint":null,"builtin":false}]});
        assert!(validate(long_label, Provider::Codex).is_err());
        let padded = json!({"version":1,"provider":"codex","truncated":false,"entries":[{"kind":"skill","name":"pdf","label":" Pdf ","description":null,"argumentHint":null,"builtin":false}]});
        assert!(validate(padded, Provider::Codex).is_err());
        assert!(validate(json!("catalog"), Provider::Codex).is_err());
    }

    #[test]
    fn only_valid_supported_exact_runner_descriptors_admit_catalogs() {
        let base = json!({"protocolVersion":1,"runnerId":"expected","name":"Server","capabilities":{"taskExecution":true,"eventReplay":true,"commandCatalog":true}});
        assert!(admit_descriptor(base.clone(), "expected").is_ok());
        assert_eq!(
            admit_descriptor(base.clone(), "foreign").err().as_deref(),
            Some(CHANGED)
        );
        for (field, value) in [
            ("protocolVersion", Value::from(2)),
            ("unknown", Value::Bool(true)),
        ] {
            let mut invalid = base.clone();
            invalid[field] = value;
            assert!(admit_descriptor(invalid, "expected").is_err());
        }
        for value in [Value::Bool(false), Value::Null, Value::from("true")] {
            let mut unsupported = base.clone();
            unsupported["capabilities"]["commandCatalog"] = value;
            assert!(admit_descriptor(unsupported, "expected").is_err());
        }
        let mut missing = base;
        missing["capabilities"]
            .as_object_mut()
            .unwrap()
            .remove("commandCatalog");
        assert_eq!(
            admit_descriptor(missing, "expected").err().as_deref(),
            Some(UNSUPPORTED)
        );
    }
}
