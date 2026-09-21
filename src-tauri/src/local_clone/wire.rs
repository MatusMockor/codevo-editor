use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CloneRequest {
    pub idempotency_key: String,
    pub url: String,
    pub name: String,
    pub parent_path: String,
    #[serde(default, deserialize_with = "optional_branch")]
    pub branch: Option<String>,
}
fn optional_branch<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct JobRequest {
    pub clone_id: String,
}
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub clone_id: String,
    pub status: Status,
    pub path: Option<String>,
    pub error: Option<String>,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    Running,
    Completed,
    Failed,
    Cancelled,
}

pub(super) fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_digit() || (b'a'..=b'f').contains(&b)
            }
        })
}
impl CloneRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        if !valid_id(&self.idempotency_key)
            || !crate::remote_runner::repository_url(&self.url)
            || self.name.is_empty()
            || self.name.len() > 64
            || !self.name.as_bytes()[0].is_ascii_alphanumeric()
            || !self
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || self.parent_path.len() > 4096
            || self.parent_path.contains('\0')
            || !std::path::Path::new(&self.parent_path).is_absolute()
            || self
                .branch
                .as_deref()
                .is_some_and(|b| !crate::remote_runner::branch_name(b))
        {
            return Err("Invalid local clone request.".into());
        }
        Ok(())
    }
}
