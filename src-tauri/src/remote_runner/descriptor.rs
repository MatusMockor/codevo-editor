use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    protocol_version: u8,
    runner_id: String,
    name: String,
    capabilities: Capabilities,
    #[serde(default, deserialize_with = "optional_timeout")]
    execution_timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Capabilities {
    task_execution: bool,
    event_replay: bool,
    task_drafts: Option<bool>,
    image_attachments: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    project_cloning: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    task_continuation: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    task_launch_options: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    task_file_diffs: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    pending_messages: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    output_artifacts: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    instruction_sync: Option<bool>,
    #[serde(default, deserialize_with = "optional_bool")]
    interactive_questions: Option<bool>,
}

fn optional_timeout<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u64>, D::Error> {
    let value = u64::deserialize(deserializer)?;
    if !(60_000..=604_800_000).contains(&value) {
        return Err(serde::de::Error::custom("Invalid execution timeout"));
    }
    Ok(Some(value))
}

fn optional_bool<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<bool>, D::Error> {
    bool::deserialize(deserializer).map(Some)
}

pub(super) fn validate(value: Value) -> Result<String, String> {
    let descriptor: Descriptor =
        serde_json::from_value(value).map_err(|_| "Unsupported runner protocol")?;
    if descriptor.protocol_version != 1
        || descriptor.runner_id.trim().is_empty()
        || descriptor.runner_id.len() > 128
        || descriptor.runner_id.chars().any(char::is_control)
        || descriptor.name.trim().is_empty()
        || descriptor.name.len() > 256
    {
        return Err("Unsupported runner protocol".into());
    }
    let _ = descriptor.execution_timeout_ms;
    let caps = descriptor.capabilities;
    let _ = (
        caps.task_execution,
        caps.event_replay,
        caps.task_drafts,
        caps.image_attachments,
        caps.project_cloning,
        caps.task_continuation,
        caps.task_launch_options,
        caps.task_file_diffs,
        caps.pending_messages,
        caps.output_artifacts,
        caps.instruction_sync,
        caps.interactive_questions,
    );
    Ok(descriptor.runner_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn execution_policy_and_interaction_capability_are_strict() {
        let base = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true}});
        for timeout in [60_000_u64, 43_200_000, 604_800_000] {
            let mut v = base.clone();
            v["executionTimeoutMs"] = timeout.into();
            assert!(validate(v).is_ok());
        }
        for timeout in [
            Value::Null,
            serde_json::json!(59999),
            serde_json::json!(604800001),
            serde_json::json!(60000.5),
            serde_json::json!("60000"),
        ] {
            let mut v = base.clone();
            v["executionTimeoutMs"] = timeout;
            assert!(validate(v).is_err());
        }
        for cap in [true, false] {
            let mut v = base.clone();
            v["capabilities"]["interactiveQuestions"] = cap.into();
            assert!(validate(v).is_ok());
        }
        let mut v = base;
        v["capabilities"]["interactiveQuestions"] = Value::Null;
        assert!(validate(v).is_err());
    }
    #[test]
    fn output_artifacts_capability_is_optional_and_strict() {
        let mut value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true}});
        assert!(validate(value.clone()).is_ok());
        for supported in [true, false] {
            value["capabilities"]["outputArtifacts"] = supported.into();
            assert!(validate(value.clone()).is_ok());
        }
        for invalid in [
            Value::Null,
            "true".into(),
            1.into(),
            serde_json::json!({}),
            serde_json::json!([]),
        ] {
            value["capabilities"]["outputArtifacts"] = invalid;
            assert!(validate(value.clone()).is_err());
        }
    }

    #[test]
    fn instruction_sync_capability_is_optional_and_strict() {
        let mut value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true}});
        assert!(validate(value.clone()).is_ok());
        for supported in [true, false] {
            value["capabilities"]["instructionSync"] = supported.into();
            assert!(validate(value.clone()).is_ok());
        }
        for invalid in [Value::Null, "true".into(), 1.into(), serde_json::json!({})] {
            value["capabilities"]["instructionSync"] = invalid;
            assert!(validate(value.clone()).is_err());
        }
    }

    #[test]
    fn rejects_control_characters_before_identity_can_be_saved() {
        for runner_id in [
            "runner\nidentity",
            "runner\ridentity",
            "runner\0identity",
            "runner\u{7f}identity",
            "runner\u{85}identity",
        ] {
            let value = serde_json::json!({"protocolVersion":1,"runnerId":runner_id,"name":"Test","capabilities":{"taskExecution":true,"eventReplay":true}});
            assert!(
                validate(value).is_err(),
                "accepted control character in {runner_id:?}"
            );
        }
    }

    #[test]
    fn rejects_wrong_protocol_and_unknown_fields() {
        let value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true}});
        assert!(validate(value.clone()).is_ok());
        let mut wrong = value.clone();
        wrong["protocolVersion"] = 2.into();
        assert!(validate(wrong).is_err());
        let mut wrong = value;
        wrong["capabilities"]["unknown"] = true.into();
        assert!(validate(wrong).is_err());
    }

    #[test]
    fn pending_capability_is_optional_and_strict() {
        let mut value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true,"pendingMessages":true}});
        assert!(validate(value.clone()).is_ok());
        value["capabilities"]["pendingMessages"] = false.into();
        assert!(validate(value.clone()).is_ok());
        for invalid in [Value::Null, "true".into(), 1.into()] {
            value["capabilities"]["pendingMessages"] = invalid;
            assert!(validate(value.clone()).is_err());
        }
    }

    #[test]
    fn launch_capability_is_optional_and_strict() {
        let mut value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true,"taskLaunchOptions":true}});
        assert!(validate(value.clone()).is_ok());
        for invalid in [Value::Null, "true".into(), 1.into()] {
            value["capabilities"]["taskLaunchOptions"] = invalid;
            assert!(validate(value.clone()).is_err());
        }
    }

    #[test]
    fn accepts_optional_project_cloning_capability() {
        let mut value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true,"projectCloning":true}});
        assert!(validate(value.clone()).is_ok());
        let mut null = value.clone();
        null["capabilities"]["projectCloning"] = Value::Null;
        assert!(validate(null).is_err());
        value["capabilities"]["projectCloning"] = "true".into();
        assert!(validate(value).is_err());
    }
    #[test]
    fn accepts_only_boolean_optional_continuation_capability() {
        let mut value = serde_json::json!({"protocolVersion":1,"runnerId":"test","name":"Test","capabilities":{"taskExecution":true,"eventReplay":true,"taskContinuation":true}});
        assert!(validate(value.clone()).is_ok());
        value["capabilities"]["taskContinuation"] = false.into();
        assert!(validate(value.clone()).is_ok());
        for invalid in [Value::Null, "true".into(), 1.into()] {
            value["capabilities"]["taskContinuation"] = invalid;
            assert!(validate(value.clone()).is_err());
        }
    }
}
