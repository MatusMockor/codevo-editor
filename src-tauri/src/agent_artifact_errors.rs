//! User-visible artifact failures that the frontend classifies into retry policy.
//! Every string here is pinned against `contracts/agent-artifact-errors.json`.

pub(crate) const SNAPSHOT_MISSING: &str = "This older turn has no saved artifact snapshot.";
pub(crate) const CHANGED_WHILE_READING: &str = "Artifact changed while reading.";
pub(crate) const CHANGED_AFTER_TURN_ENDED: &str = "Artifact changed after this turn ended.";
pub(crate) const TURN_END_UNRECORDED: &str =
    "This turn has no recorded end time, so its files cannot be verified.";
pub(crate) const CONVERSATION_ADVANCED: &str =
    "The conversation advanced before its artifact was saved.";
pub(crate) const UNBOUNDED_OR_LINKED_FILE: &str =
    "Artifact must be a bounded regular file without hard links.";
pub(crate) const NOT_A_REGULAR_FILE: &str = "Artifact must be a regular file.";
pub(crate) const MEDIA_TYPE_MISMATCH: &str =
    "Artifact content does not match its supported media type.";
pub(crate) const UNSUPPORTED_MEDIA_TYPE: &str =
    "Only HTML, PNG, JPEG and WebP artifacts are supported.";
pub(crate) const STORAGE_BUSY: &str = "Artifact storage is busy. Try again.";

#[cfg(test)]
pub(crate) const NEWEST_TERMINAL_TURN_RULE: &str =
    "Capture only a terminal turn that has no terminal successor.";

#[cfg(test)]
pub(crate) const CLASSIFIED: &[&str] = &[
    SNAPSHOT_MISSING,
    CHANGED_WHILE_READING,
    CHANGED_AFTER_TURN_ENDED,
    TURN_END_UNRECORDED,
    CONVERSATION_ADVANCED,
    UNBOUNDED_OR_LINKED_FILE,
    NOT_A_REGULAR_FILE,
    MEDIA_TYPE_MISMATCH,
    UNSUPPORTED_MEDIA_TYPE,
    STORAGE_BUSY,
];

#[cfg(test)]
pub(crate) const MANIFEST: &str = include_str!("../../contracts/agent-artifact-errors.json");

#[cfg(test)]
mod tests {
    use super::{CLASSIFIED, MANIFEST, NEWEST_TERMINAL_TURN_RULE};
    use std::collections::BTreeSet;

    #[test]
    fn classified_messages_equal_the_cross_language_manifest() {
        let manifest: serde_json::Value =
            serde_json::from_str(MANIFEST).expect("parse the artifact error contract");
        let messages = manifest
            .get("backendMessages")
            .and_then(serde_json::Value::as_object)
            .expect("backendMessages object");
        let contracted: BTreeSet<&str> = messages
            .values()
            .flat_map(|reason| {
                reason
                    .as_array()
                    .expect("backend messages array")
                    .iter()
                    .map(|message| message.as_str().expect("backend message string"))
            })
            .collect();
        let implemented: BTreeSet<&str> = CLASSIFIED.iter().copied().collect();
        assert_eq!(implemented, contracted);
        assert_eq!(implemented.len(), CLASSIFIED.len());
    }

    const PRODUCTION_SOURCES: [(&str, &str); 3] = [
        (
            "agent_output_artifact_store.rs",
            include_str!("agent_output_artifact_store.rs"),
        ),
        (
            "agent_output_artifact_files.rs",
            include_str!("agent_output_artifact_files.rs"),
        ),
        (
            "lib_composition/agent_output_artifact_commands.rs",
            include_str!("lib_composition/agent_output_artifact_commands.rs"),
        ),
    ];

    #[test]
    fn production_sites_build_classified_messages_only_from_the_constants() {
        for (name, source) in PRODUCTION_SOURCES {
            for message in CLASSIFIED {
                assert!(
                    !source.contains(message),
                    "{name} inlines the classified message {message:?}"
                );
            }
        }
    }

    #[test]
    fn newest_terminal_turn_rule_equals_the_cross_language_manifest() {
        let manifest: serde_json::Value =
            serde_json::from_str(MANIFEST).expect("parse the artifact error contract");
        assert_eq!(
            manifest
                .get("newestTerminalTurnRule")
                .and_then(|rule| rule.as_str()),
            Some(NEWEST_TERMINAL_TURN_RULE)
        );
    }
}
