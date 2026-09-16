use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Descriptor {
    protocol_version: u8,
    runner_id: String,
    name: String,
    capabilities: Capabilities,
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
    );
    Ok(descriptor.runner_id)
}

#[cfg(test)]
mod tests {
    use super::*;
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
