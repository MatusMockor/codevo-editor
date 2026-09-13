use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub username: String,
    pub port: u16,
    #[serde(default)]
    pub connected: bool,
    #[serde(skip)]
    pub runner_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectRequest {
    pub id: String,
    pub name: String,
    pub host: String,
    pub username: String,
    pub port: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerRequest {
    pub server_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PageRequest {
    pub server_id: String,
    pub after: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskRequest {
    pub server_id: String,
    pub task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventsRequest {
    pub server_id: String,
    pub task_id: String,
    pub after: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub server_id: String,
    pub task_id: String,
    pub project_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Claude,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Part {
    Text {
        text: String,
    },
    Attachment {
        #[serde(rename = "attachmentId")]
        attachment_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateRequest {
    pub server_id: String,
    pub idempotency_key: String,
    pub provider: Provider,
    #[serde(default, deserialize_with = "super::launch::optional")]
    pub(super) launch: Option<super::launch::Launch>,
    pub parts: Vec<Part>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UploadRequest {
    pub server_id: String,
    pub attachment_id: String,
    pub name: String,
    pub media_type: String,
    pub base64: String,
}

pub(super) fn id(value: &str) -> Result<(), String> {
    if !value
        .as_bytes()
        .first()
        .is_some_and(u8::is_ascii_alphanumeric)
        || value.len() > 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("Invalid runner identifier".into());
    }
    Ok(())
}

pub(super) fn uuid(value: &str) -> Result<(), String> {
    if value.len() != 36
        || value.as_bytes().get(14) != Some(&b'4')
        || !value
            .as_bytes()
            .get(19)
            .is_some_and(|b| b"89ab".contains(b))
        || !value.bytes().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
    {
        return Err("Invalid runner UUID".into());
    }
    Ok(())
}

pub(super) fn validate_parts(parts: &[Part]) -> Result<(), String> {
    if parts.is_empty() || parts.len() > 16 {
        return Err("Invalid message parts".into());
    }
    let mut text_bytes = 0usize;
    let mut attachments = std::collections::HashSet::new();
    for part in parts {
        match part {
            Part::Text { text } => {
                if text.trim().is_empty() || text.contains('\0') {
                    return Err("Invalid message text".into());
                }
                text_bytes = text_bytes.saturating_add(text.len());
            }
            Part::Attachment { attachment_id } => {
                uuid(attachment_id)?;
                if !attachments.insert(attachment_id) {
                    return Err("Duplicate image attachment".into());
                }
            }
        }
    }
    if text_bytes > 48_000 || attachments.len() > 8 {
        return Err("Message exceeds runner limits".into());
    }
    Ok(())
}

impl ConnectRequest {
    pub(super) fn validate(self) -> Result<Server, String> {
        id(&self.id)?;
        if self.name.trim().is_empty()
            || self.name.len() > 80
            || self.name.chars().any(char::is_control)
            || self.host.is_empty()
            || self.host.len() > 253
            || !self
                .host
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphanumeric)
            || !self
                .host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
            || self.username.is_empty()
            || self.username.len() > 64
            || !self
                .username
                .as_bytes()
                .first()
                .is_some_and(|b| b.is_ascii_alphabetic() || *b == b'_')
            || !self
                .username
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || self.port == 0
        {
            return Err("Invalid server connection settings".into());
        }
        Ok(Server {
            id: self.id,
            name: self.name,
            host: self.host,
            username: self.username,
            port: self.port,
            connected: true,
            runner_id: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_shell_and_option_injection_and_unknown_fields() {
        for host in [
            "-oProxyCommand=x",
            "host;touch /tmp/x",
            "$(id)",
            "host\nother",
        ] {
            let request = ConnectRequest {
                id: "test".into(),
                name: "Test".into(),
                host: host.into(),
                username: "codex".into(),
                port: 22,
            };
            assert!(request.validate().is_err());
        }
        assert!(
            serde_json::from_str::<ServerRequest>(r#"{"serverId":"a","command":"id"}"#).is_err()
        );
        assert!(id("../task").is_err());
    }
}
