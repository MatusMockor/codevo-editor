use super::{
    commands::{blocking, OperationClass},
    project_management::{call_lease, valid_directory_path},
    service::RemoteRunnerState,
    types::id,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisterProjectRequest {
    server_id: String,
    path: String,
    name: String,
}

impl RegisterProjectRequest {
    fn body(&self) -> Result<Value, String> {
        id(&self.server_id)?;
        id(&self.name)?;
        if !valid_directory_path(&self.path) || self.path == "/" {
            return Err("Invalid project directory".into());
        }
        Ok(json!({"path": self.path, "name": self.name}))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RegisteredProject {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RejectionReason {
    NotGitRoot,
    NameTaken,
    LimitReached,
    NotAllowed,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "lowercase", deny_unknown_fields)]
enum RegistrationResponse {
    Registered {
        project: RegisteredProject,
        created: bool,
    },
    Rejected {
        reason: RejectionReason,
    },
}

const PROJECT_NAME_BYTES: usize = 256;

fn valid_project_name(name: &str) -> bool {
    name.len() <= PROJECT_NAME_BYTES && !name.contains('\0') && !name.chars().all(script_blank)
}

fn script_blank(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

fn validate_registration(value: Value) -> Result<Value, String> {
    let response: RegistrationResponse = serde_json::from_value(value.clone())
        .map_err(|_| "Invalid project registration response")?;
    match response {
        RegistrationResponse::Registered { project, created } => {
            let _ = created;
            if id(&project.id).is_err() || !valid_project_name(&project.name) {
                return Err("Invalid project registration response".into());
            }
        }
        RegistrationResponse::Rejected { reason } => {
            let _ = reason;
        }
    }
    Ok(value)
}

#[tauri::command]
pub async fn remote_runner_register_project(
    state: tauri::State<'_, RemoteRunnerState>,
    request: RegisterProjectRequest,
) -> Result<Value, String> {
    let body = request.body()?;
    let lease = state.connection_lease(&request.server_id)?;
    blocking(OperationClass::Bulk, move || {
        validate_registration(call_lease(
            lease,
            "POST",
            "/v1/projects/register",
            Some(body),
        )?)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_is_closed_required_and_serializes_only_semantic_fields() {
        let input = json!({"serverId":"server","path":"/projects/repo","name":"repo"});
        let request: RegisterProjectRequest = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(
            request.body().unwrap(),
            json!({"path":"/projects/repo","name":"repo"})
        );
        let mut extra = input.clone();
        extra["command"] = "id".into();
        assert!(serde_json::from_value::<RegisterProjectRequest>(extra).is_err());
        for field in ["serverId", "path", "name"] {
            let mut missing = input.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<RegisterProjectRequest>(missing).is_err());
        }
    }

    #[test]
    fn request_rejects_bad_names_paths_and_server_ids() {
        let mut request = RegisterProjectRequest {
            server_id: "server".into(),
            path: "/projects/repo".into(),
            name: "repo".into(),
        };
        for name in ["", "-x", "a b", "a/b", &"a".repeat(65)] {
            request.name = name.into();
            assert!(request.body().is_err(), "{name}");
        }
        for name in ["A", "a_b-9", &"a".repeat(64)] {
            request.name = name.into();
            assert!(request.body().is_ok(), "{name}");
        }
        for path in ["relative", "/a/../b", "/a//b", "/a/", "/"] {
            request.path = path.into();
            assert!(request.body().is_err(), "{path}");
        }
        request.path = "/projects/repo".into();
        request.server_id = "../server".into();
        assert!(request.body().is_err());
    }

    #[test]
    fn response_accepts_registered_and_every_rejection_unchanged() {
        for created in [true, false] {
            let value = json!({"status":"registered","project":{"id":"repo","name":"Repository"},"created":created});
            assert_eq!(validate_registration(value.clone()).unwrap(), value);
        }
        for reason in ["not_git_root", "name_taken", "limit_reached", "not_allowed"] {
            let value = json!({"status":"rejected","reason":reason});
            assert_eq!(validate_registration(value.clone()).unwrap(), value);
        }
        for name in [
            "a".to_string(),
            "a".repeat(100),
            "a".repeat(101),
            "a".repeat(256),
            "\u{e9}".repeat(128),
            "\u{1f680}".repeat(64),
            "bell\u{7}name".to_string(),
            "two\nlines".to_string(),
            "  padded  ".to_string(),
            "\u{85}".to_string(),
        ] {
            let value =
                json!({"status":"registered","project":{"id":"repo","name":name},"created":true});
            assert_eq!(validate_registration(value.clone()).unwrap(), value);
        }
    }

    #[test]
    fn response_rejects_unknown_missing_extra_and_invalid_fields() {
        let base = json!({"status":"registered","project":{"id":"repo","name":"Repository"},"created":true});
        let mut invalid = vec![
            json!({"status":"rejected","reason":"unknown"}),
            json!({"status":"unknown","reason":"not_allowed"}),
            json!({"status":"rejected"}),
            json!({"status":"rejected","reason":"not_allowed","extra":true}),
            json!({"status":"registered","project":{"id":"repo","name":"Repository"}}),
            json!({"status":"registered","created":true}),
        ];
        let mut extra = base.clone();
        extra["extra"] = true.into();
        invalid.push(extra);
        let mut extra = base.clone();
        extra["project"]["extra"] = true.into();
        invalid.push(extra);
        for created in [Value::Null, "true".into(), 1.into()] {
            let mut value = base.clone();
            value["created"] = created;
            invalid.push(value);
        }
        for project_id in ["", "../repo", &"a".repeat(65)] {
            let mut value = base.clone();
            value["project"]["id"] = project_id.into();
            invalid.push(value);
        }
        for name in [
            "",
            " ",
            "   ",
            "\t\n\r",
            "\u{a0}\u{2003}\u{3000}\u{feff}",
            &"a".repeat(257),
            &"\u{e9}".repeat(129),
            &"\u{1f680}".repeat(65),
            "nul\0name",
        ] {
            let mut value = base.clone();
            value["project"]["name"] = name.into();
            invalid.push(value);
        }
        for field in ["id", "name"] {
            let mut value = base.clone();
            value["project"].as_object_mut().unwrap().remove(field);
            invalid.push(value);
        }
        for value in invalid {
            assert_eq!(
                validate_registration(value).unwrap_err(),
                "Invalid project registration response"
            );
        }
    }
}
