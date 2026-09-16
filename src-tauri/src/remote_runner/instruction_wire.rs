use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq, Hash)]
#[serde(rename_all = "lowercase")]
pub(super) enum InstructionScope {
    Global,
    Project,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct InstructionFile {
    pub scope: InstructionScope,
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct InstructionSnapshot {
    pub(super) version: u8,
    pub(super) files: Vec<InstructionFile>,
}

impl InstructionSnapshot {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.version != 1 || self.files.len() > 128 {
            return Err("Unsupported or oversized instruction snapshot".into());
        }
        let mut paths = HashSet::new();
        let mut bytes = 0usize;
        for file in &self.files {
            let parts: Vec<_> = file.path.split('/').collect();
            if !file.path.to_ascii_lowercase().ends_with(".md")
                || file.path.len() > 512
                || parts.len() > 32
                || parts.iter().any(|part| {
                    part.is_empty()
                        || matches!(*part, "." | "..")
                        || part.eq_ignore_ascii_case(".git")
                        || part.ends_with(['.', ' '])
                })
                || file
                    .path
                    .chars()
                    .any(|c| c.is_control() || matches!(c, '\\' | ':'))
                || file.content.len() > 64 * 1024
                || file.content.contains('\0')
                || !paths.insert((
                    file.scope.clone(),
                    file.path.nfc().collect::<String>().to_lowercase(),
                ))
            {
                return Err("Invalid instruction file path, content, or duplicate".into());
            }
            bytes = bytes.saturating_add(file.content.len());
            if bytes > 512 * 1024 {
                return Err("Instruction snapshot exceeds the total size limit".into());
            }
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for InstructionSnapshot {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            version: u8,
            files: Vec<InstructionFile>,
        }
        let wire = Wire::deserialize(deserializer)?;
        let snapshot = Self {
            version: wire.version,
            files: wire.files,
        };
        snapshot.validate().map_err(serde::de::Error::custom)?;
        Ok(snapshot)
    }
}

pub(super) fn optional<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<InstructionSnapshot>, D::Error> {
    InstructionSnapshot::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn input() -> Value {
        json!({"version":1,"files":[{"scope":"global","path":"CLAUDE.md","content":"Follow these rules"}]})
    }

    #[test]
    fn closed_snapshot_rejects_invalid_paths_and_case_collisions() {
        for path in [
            "",
            "/CLAUDE.md",
            "../CLAUDE.md",
            "a//b",
            "a/./b",
            "a\\b",
            "C:file",
            "a\nb",
            "rules./a.md",
            "rules /a.md",
            "script.sh",
        ] {
            let mut value = input();
            value["files"][0]["path"] = path.into();
            assert!(serde_json::from_value::<InstructionSnapshot>(value).is_err());
        }
        for value in [
            Value::Null,
            json!({"version":2,"files":[]}),
            json!({"version":1,"files":[],"command":"x"}),
        ] {
            assert!(serde_json::from_value::<InstructionSnapshot>(value).is_err());
        }
        let mut value = input();
        let mut duplicate = value["files"][0].clone();
        duplicate["path"] = "claude.md".into();
        value["files"].as_array_mut().unwrap().push(duplicate);
        assert!(serde_json::from_value::<InstructionSnapshot>(value.clone()).is_err());
        value["files"][1]["scope"] = "project".into();
        assert!(serde_json::from_value::<InstructionSnapshot>(value).is_ok());
    }

    #[test]
    fn snapshot_normalizes_unicode_collisions_and_accepts_uppercase_extension() {
        let mut value = input();
        value["files"][0]["path"] = "RULES.MD".into();
        assert!(serde_json::from_value::<InstructionSnapshot>(value).is_ok());
        let files = ["é.md", "e\u{301}.md"]
            .map(|path| json!({"scope":"project","path":path,"content":"rules"}));
        assert!(
            serde_json::from_value::<InstructionSnapshot>(json!({"version":1,"files":files}))
                .is_err()
        );
    }

    #[test]
    fn snapshot_enforces_utf8_and_aggregate_bounds() {
        let mut value = input();
        value["files"][0]["content"] = "é".repeat(32 * 1024).into();
        assert!(serde_json::from_value::<InstructionSnapshot>(value.clone()).is_ok());
        value["files"][0]["content"] = "é".repeat(32 * 1024 + 1).into();
        assert!(serde_json::from_value::<InstructionSnapshot>(value).is_err());
        let files: Vec<_> = (0..9).map(|i| json!({"scope":"project","path":format!("{i}/CLAUDE.md"),"content":"x".repeat(64*1024)})).collect();
        assert!(
            serde_json::from_value::<InstructionSnapshot>(json!({"version":1,"files":files}))
                .is_err()
        );
        let files: Vec<_> = (0..129)
            .map(|i| json!({"scope":"project","path":format!("{i}/CLAUDE.md"),"content":""}))
            .collect();
        assert!(
            serde_json::from_value::<InstructionSnapshot>(json!({"version":1,"files":files}))
                .is_err()
        );
    }
}
