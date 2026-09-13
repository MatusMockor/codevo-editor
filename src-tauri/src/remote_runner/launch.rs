use crate::agent_task_spawner::agent_launch::AgentLaunchOptions;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// Validated local launch contract, retaining omitted optional fields on the wire.
#[derive(Serialize)]
#[serde(transparent)]
pub(super) struct Launch(Value);

impl<'de> Deserialize<'de> for Launch {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        if value.get("provider").and_then(Value::as_str) == Some("claudeCode")
            && value.get("effort").is_none()
        {
            return Err(serde::de::Error::custom("Claude effort is required"));
        }
        let launch: AgentLaunchOptions =
            serde_json::from_value(value.clone()).map_err(serde::de::Error::custom)?;
        launch
            .validate_capabilities()
            .map_err(serde::de::Error::custom)?;
        Ok(Self(value))
    }
}

impl Launch {
    pub(super) fn matches(&self, provider: &super::types::Provider) -> bool {
        self.0.get("provider").and_then(Value::as_str)
            == Some(match provider {
                super::types::Provider::Claude => "claudeCode",
                super::types::Provider::Codex => "codex",
            })
    }
}

pub(super) fn optional<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Launch>, D::Error> {
    Launch::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_unknown_and_unsupported_launches() {
        for value in [
            json!({"provider":"codex","model":"shell","mode":"default"}),
            json!({"provider":"codex","model":"default","mode":"default","args":[]}),
            json!({"provider":"claudeCode","model":"sonnet","mode":"default","effort":"high","fastMode":true}),
            json!({"provider":"claudeCode","model":"opus","mode":"default"}),
            Value::Null,
        ] {
            assert!(serde_json::from_value::<Launch>(value).is_err());
        }
    }

    #[test]
    fn preserves_optional_fields_and_checks_provider() {
        let value = json!({"provider":"claudeCode","model":"opus","mode":"plan","effort":"high"});
        let launch: Launch = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(&launch).unwrap(), value);
        assert!(launch.matches(&super::super::types::Provider::Claude));
        assert!(!launch.matches(&super::super::types::Provider::Codex));
    }
}
