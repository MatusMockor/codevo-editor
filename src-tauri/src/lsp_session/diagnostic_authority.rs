use crate::file_uri_path::path_from_file_uri;
use crate::lsp_diagnostics::{
    classify_publish_diagnostics_bytes, LanguageServerDiagnosticEvent,
    LanguageServerDiagnosticProjectionReason, PublishDiagnosticsBytes,
    MAX_DIAGNOSTIC_AUTHORITY_DATA_NODES, MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES,
    MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_ENTRIES, MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_UTF8_BYTES,
};
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use super::workspace_runtime_identity::normalize_path;
use super::{workspace_guard_path, DiagnosticsSink};

#[derive(Clone, Copy)]
struct DiagnosticAuthorityLimits {
    data_nodes: usize,
    path_probes: usize,
    cache_entries: usize,
    cache_utf8_bytes: usize,
}

impl Default for DiagnosticAuthorityLimits {
    fn default() -> Self {
        Self {
            data_nodes: MAX_DIAGNOSTIC_AUTHORITY_DATA_NODES,
            path_probes: MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES,
            cache_entries: MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_ENTRIES,
            cache_utf8_bytes: MAX_DIAGNOSTIC_AUTHORITY_PATH_CACHE_UTF8_BYTES,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AuthorityDecision {
    Allowed,
    Rejected,
    AuthorityNodeLimit,
    PathProbeLimit,
}

struct DiagnosticAuthorityProjection {
    workspace_root: PathBuf,
    remaining_data_nodes: usize,
    remaining_path_probes: usize,
    remaining_cache_utf8_bytes: usize,
    cache_entry_limit: usize,
    path_cache: HashMap<PathBuf, AuthorityDecision>,
    #[cfg(test)]
    path_probes_performed: usize,
}

impl DiagnosticAuthorityProjection {
    fn new(workspace_root: &str, limits: DiagnosticAuthorityLimits) -> Option<Self> {
        Some(Self {
            workspace_root: workspace_guard_path(workspace_root).ok()?,
            remaining_data_nodes: limits.data_nodes,
            remaining_path_probes: limits.path_probes,
            remaining_cache_utf8_bytes: limits.cache_utf8_bytes,
            cache_entry_limit: limits.cache_entries,
            path_cache: HashMap::new(),
            #[cfg(test)]
            path_probes_performed: 0,
        })
    }

    fn consume_data_node(&mut self) -> bool {
        if self.remaining_data_nodes == 0 {
            return false;
        }
        self.remaining_data_nodes -= 1;
        true
    }

    fn authorize_uri_if_file(&mut self, value: &str) -> AuthorityDecision {
        let Ok(uri) = url::Url::parse(value) else {
            return AuthorityDecision::Rejected;
        };
        if !uri.scheme().eq_ignore_ascii_case("file") {
            return AuthorityDecision::Allowed;
        }
        let Some(path) = path_from_file_uri(uri.as_str()) else {
            return AuthorityDecision::Rejected;
        };
        self.authorize_path(Path::new(&path))
    }

    fn authorize_required_file_uri(&mut self, value: &str) -> AuthorityDecision {
        let Ok(uri) = url::Url::parse(value) else {
            return AuthorityDecision::Rejected;
        };
        if !uri.scheme().eq_ignore_ascii_case("file") {
            return AuthorityDecision::Rejected;
        }
        let Some(path) = path_from_file_uri(uri.as_str()) else {
            return AuthorityDecision::Rejected;
        };
        self.authorize_path(Path::new(&path))
    }

    fn authorize_path(&mut self, path: &Path) -> AuthorityDecision {
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.workspace_root.join(path)
        };
        if let Some(decision) = self.path_cache.get(&candidate) {
            return *decision;
        }

        let decision = match self.resolve_path(&candidate) {
            Err(()) => return AuthorityDecision::PathProbeLimit,
            Ok(Some(canonical)) => {
                if canonical.starts_with(&self.workspace_root) {
                    AuthorityDecision::Allowed
                } else {
                    AuthorityDecision::Rejected
                }
            }
            Ok(None) => AuthorityDecision::Rejected,
        };
        self.memoize(candidate, decision);
        decision
    }

    fn resolve_path(&mut self, path: &Path) -> Result<Option<PathBuf>, ()> {
        if !self.consume_path_probe() {
            return Err(());
        }
        if let Ok(canonical) = path.canonicalize() {
            return Ok(Some(canonical));
        }

        let mut cursor = path.to_path_buf();
        let mut missing_components: Vec<OsString> = Vec::new();
        loop {
            if !self.consume_path_probe() {
                return Err(());
            }
            match cursor.symlink_metadata() {
                Ok(_) => break,
                Err(error) if error.kind() == ErrorKind::NotFound => {
                    let Some(component) = cursor.file_name() else {
                        return Ok(None);
                    };
                    missing_components.push(component.to_os_string());
                    if !cursor.pop() {
                        return Ok(None);
                    }
                }
                Err(_) => return Ok(None),
            }
        }

        if !self.consume_path_probe() {
            return Err(());
        }
        let Ok(mut resolved) = cursor.canonicalize() else {
            return Ok(None);
        };
        while let Some(component) = missing_components.pop() {
            resolved.push(component);
        }
        Ok(Some(normalize_path(&resolved)))
    }

    fn consume_path_probe(&mut self) -> bool {
        if self.remaining_path_probes == 0 {
            return false;
        }
        self.remaining_path_probes -= 1;
        #[cfg(test)]
        {
            self.path_probes_performed += 1;
        }
        true
    }

    fn memoize(&mut self, candidate: PathBuf, decision: AuthorityDecision) {
        if self.path_cache.len() >= self.cache_entry_limit {
            return;
        }
        let bytes = candidate.to_string_lossy().len();
        if bytes > self.remaining_cache_utf8_bytes {
            return;
        }
        self.remaining_cache_utf8_bytes -= bytes;
        self.path_cache.insert(candidate, decision);
    }
}

pub(super) fn consume_diagnostic_bytes(
    bytes: &[u8],
    session_id: u64,
    workspace_root: &str,
    sink: &dyn DiagnosticsSink,
) -> bool {
    match classify_publish_diagnostics_bytes(bytes, session_id) {
        PublishDiagnosticsBytes::NotNotification => false,
        PublishDiagnosticsBytes::Malformed => true,
        PublishDiagnosticsBytes::Event(event) => {
            if let Some(event) = filter_diagnostic_event_to_workspace(workspace_root, event) {
                sink.emit_diagnostics(event);
            }
            true
        }
    }
}

fn ensure_diagnostic_json_payload_paths_in_workspace(
    authority: &mut DiagnosticAuthorityProjection,
    value: &Value,
    path_context: bool,
) -> Result<(), AuthorityDecision> {
    if !authority.consume_data_node() {
        return Err(AuthorityDecision::AuthorityNodeLimit);
    }

    match value {
        Value::Array(items) => {
            for item in items {
                ensure_diagnostic_json_payload_paths_in_workspace(authority, item, path_context)?;
            }
        }
        Value::Object(fields) => {
            for (key, field_value) in fields {
                if !authority.consume_data_node() {
                    return Err(AuthorityDecision::AuthorityNodeLimit);
                }
                ensure_diagnostic_json_payload_paths_in_workspace(
                    authority,
                    field_value,
                    path_context || is_lsp_path_payload_key(key),
                )?;
            }
        }
        Value::String(value) => {
            ensure_diagnostic_payload_string_in_workspace(authority, value, path_context)?;
        }
        _ => {}
    }

    Ok(())
}

fn ensure_diagnostic_payload_string_in_workspace(
    authority: &mut DiagnosticAuthorityProjection,
    value: &str,
    path_context: bool,
) -> Result<(), AuthorityDecision> {
    let bytes = value.as_bytes();
    let windows_drive_path = bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic();
    if !windows_drive_path {
        if let Ok(uri) = url::Url::parse(value) {
            if !uri.scheme().eq_ignore_ascii_case("file") {
                return Ok(());
            }
            return decision_result(authority.authorize_uri_if_file(value));
        }
    }

    if !path_context {
        return Ok(());
    }

    decision_result(authority.authorize_path(Path::new(value)))
}

fn is_lsp_path_payload_key(key: &str) -> bool {
    let normalized = key
        .chars()
        .filter(|character| *character != '_' && *character != '-')
        .flat_map(char::to_lowercase)
        .collect::<String>();

    matches!(
        normalized.as_str(),
        "file"
            | "target"
            | "uri"
            | "path"
            | "filename"
            | "fileuri"
            | "filepath"
            | "targeturi"
            | "targetpath"
            | "ownerpath"
            | "sourcepath"
            | "documenturi"
            | "documentpath"
            | "olduri"
            | "oldpath"
            | "newuri"
            | "newpath"
            | "modulefilename"
    )
}

fn decision_result(decision: AuthorityDecision) -> Result<(), AuthorityDecision> {
    match decision {
        AuthorityDecision::Allowed => Ok(()),
        AuthorityDecision::Rejected
        | AuthorityDecision::AuthorityNodeLimit
        | AuthorityDecision::PathProbeLimit => Err(decision),
    }
}

fn receipt_reason(decision: AuthorityDecision) -> LanguageServerDiagnosticProjectionReason {
    match decision {
        AuthorityDecision::Allowed => unreachable!("allowed fields are not sanitized"),
        AuthorityDecision::Rejected => LanguageServerDiagnosticProjectionReason::Field,
        AuthorityDecision::AuthorityNodeLimit => {
            LanguageServerDiagnosticProjectionReason::AuthorityNode
        }
        AuthorityDecision::PathProbeLimit => LanguageServerDiagnosticProjectionReason::PathProbe,
    }
}

pub(super) fn is_file_uri_in_workspace(workspace_root: &str, uri: &str) -> bool {
    DiagnosticAuthorityProjection::new(
        workspace_root,
        DiagnosticAuthorityLimits {
            data_nodes: 0,
            path_probes: MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES,
            cache_entries: 0,
            cache_utf8_bytes: 0,
        },
    )
    .is_some_and(|mut authority| {
        authority.authorize_required_file_uri(uri) == AuthorityDecision::Allowed
    })
}

pub(super) fn filter_diagnostic_event_to_workspace(
    workspace_root: &str,
    event: LanguageServerDiagnosticEvent,
) -> Option<LanguageServerDiagnosticEvent> {
    filter_diagnostic_event_with_limits(workspace_root, event, DiagnosticAuthorityLimits::default())
}

fn filter_diagnostic_event_with_limits(
    workspace_root: &str,
    mut event: LanguageServerDiagnosticEvent,
    limits: DiagnosticAuthorityLimits,
) -> Option<LanguageServerDiagnosticEvent> {
    let mut authority = DiagnosticAuthorityProjection::new(workspace_root, limits)?;
    if authority.authorize_required_file_uri(&event.uri) != AuthorityDecision::Allowed {
        return None;
    }

    let mut sanitized_field_count = 0usize;
    let mut reasons = BTreeSet::new();
    for diagnostic in &mut event.diagnostics {
        diagnostic.related_information.retain(|related| {
            let decision = authority.authorize_uri_if_file(&related.uri);
            let retain = decision == AuthorityDecision::Allowed;
            if !retain {
                sanitized_field_count = sanitized_field_count.saturating_add(1);
                reasons.insert(receipt_reason(decision));
            }
            retain
        });

        if let Some(href) = diagnostic.code_description_href.as_ref() {
            let decision = authority.authorize_uri_if_file(href);
            if decision != AuthorityDecision::Allowed {
                diagnostic.code_description_href = None;
                sanitized_field_count = sanitized_field_count.saturating_add(1);
                reasons.insert(receipt_reason(decision));
            }
        }

        if let Some(data) = diagnostic.data.as_ref() {
            if let Err(decision) =
                ensure_diagnostic_json_payload_paths_in_workspace(&mut authority, data, false)
            {
                diagnostic.data = None;
                sanitized_field_count = sanitized_field_count.saturating_add(1);
                reasons.insert(receipt_reason(decision));
            }
        }
    }
    event.record_post_filter_sanitization(sanitized_field_count, reasons);

    Some(event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lsp_diagnostics::{
        parse_publish_diagnostics, LanguageServerDiagnosticProjection,
        LanguageServerDiagnosticProjectionReason,
    };
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn workspace(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("codevo-diagnostic-authority-{label}-{suffix}"));
        fs::create_dir_all(&root).expect("workspace");
        root.canonicalize().expect("canonical workspace")
    }

    fn limits(data_nodes: usize, path_probes: usize) -> DiagnosticAuthorityLimits {
        DiagnosticAuthorityLimits {
            data_nodes,
            path_probes,
            cache_entries: 16,
            cache_utf8_bytes: 16 * 1024,
        }
    }

    #[test]
    fn repeated_paths_share_one_canonicalization_probe() {
        let root = workspace("memo");
        let candidate = root.join("repeated.ts");
        fs::write(&candidate, "export {};").expect("candidate");
        let mut authority =
            DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(8, 2))
                .expect("authority");

        for _ in 0..2_000 {
            assert_eq!(
                authority.authorize_path(&candidate),
                AuthorityDecision::Allowed
            );
        }
        assert_eq!(authority.path_probes_performed, 1);
        assert_eq!(authority.remaining_path_probes, 1);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn workspace_file_authority_accepts_new_files_and_relative_paths_inside_the_root() {
        let root = workspace("new-files");
        let existing = root.join("existing.ts");
        fs::write(&existing, "export {};").expect("existing");
        let new_file_uri = url::Url::from_file_path(root.join("nested/new.ts"))
            .expect("new file URI")
            .to_string();

        assert!(is_file_uri_in_workspace(
            root.to_str().expect("root"),
            &new_file_uri
        ));

        let mut authority =
            DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(8, 1))
                .expect("authority");
        assert_eq!(
            authority.authorize_path(Path::new("existing.ts")),
            AuthorityDecision::Allowed
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn closed_known_path_fields_reject_outside_workspace_paths() {
        let root = workspace("known-path-fields");
        let outside = workspace("known-path-fields-outside");
        let outside_path = outside.join("outside.ts");
        fs::write(&outside_path, "export {};").expect("outside file");

        for key in [
            "ownerPath",
            "source_path",
            "documentUri",
            "old-uri",
            "newPath",
            "moduleFileName",
        ] {
            let mut authority =
                DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(8, 8))
                    .expect("authority");
            assert_eq!(
                ensure_diagnostic_json_payload_paths_in_workspace(
                    &mut authority,
                    &json!({ key: outside_path }),
                    false,
                ),
                Err(AuthorityDecision::Rejected),
                "{key} must be treated as a known path field"
            );
        }
        assert!(!is_lsp_path_payload_key("unrelatedPathSuffix"));
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[cfg(unix)]
    #[test]
    fn dangling_symlinks_and_nul_file_uris_fail_closed() {
        use std::os::unix::fs::symlink;

        let root = workspace("invalid-paths");
        let outside = workspace("invalid-paths-outside");
        let dangling = root.join("dangling");
        symlink(outside.join("missing.ts"), &dangling).expect("dangling symlink");
        let mut authority =
            DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(8, 8))
                .expect("authority");
        assert_eq!(
            authority.authorize_path(&dangling),
            AuthorityDecision::Rejected
        );

        let root_uri = url::Url::from_directory_path(&root).expect("root URI");
        let nul_uri = format!("{}%00name.ts", root_uri.as_str());
        assert_eq!(
            authority.authorize_required_file_uri(&nul_uri),
            AuthorityDecision::Rejected
        );
        fs::remove_file(dangling).expect("cleanup symlink");
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn unique_path_probes_and_data_nodes_stop_at_the_exact_boundary() {
        let root = workspace("boundaries");
        let mut path_authority =
            DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(8, 2))
                .expect("path authority");
        fs::write(root.join("one.ts"), "one").expect("one");
        fs::write(root.join("two.ts"), "two").expect("two");
        assert_eq!(
            path_authority.authorize_path(&root.join("one.ts")),
            AuthorityDecision::Allowed
        );
        assert_eq!(
            path_authority.authorize_path(&root.join("two.ts")),
            AuthorityDecision::Allowed
        );
        assert_eq!(
            path_authority.authorize_path(&root.join("three.ts")),
            AuthorityDecision::PathProbeLimit
        );
        assert_eq!(path_authority.path_probes_performed, 2);

        let mut node_authority =
            DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(2, 1))
                .expect("node authority");
        assert!(ensure_diagnostic_json_payload_paths_in_workspace(
            &mut node_authority,
            &json!(["plain"]),
            false,
        )
        .is_ok());
        assert_eq!(
            ensure_diagnostic_json_payload_paths_in_workspace(
                &mut node_authority,
                &Value::Null,
                false,
            ),
            Err(AuthorityDecision::AuthorityNodeLimit)
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn production_node_and_filesystem_budgets_stop_on_the_first_excess_observation() {
        let root = workspace("production-boundaries");
        let mut node_authority = DiagnosticAuthorityProjection::new(
            root.to_str().expect("root"),
            DiagnosticAuthorityLimits::default(),
        )
        .expect("node authority");
        let exact_nodes = Value::Array(vec![Value::Null; MAX_DIAGNOSTIC_AUTHORITY_DATA_NODES - 1]);
        assert!(ensure_diagnostic_json_payload_paths_in_workspace(
            &mut node_authority,
            &exact_nodes,
            false,
        )
        .is_ok());
        assert_eq!(
            ensure_diagnostic_json_payload_paths_in_workspace(
                &mut node_authority,
                &Value::Null,
                false,
            ),
            Err(AuthorityDecision::AuthorityNodeLimit)
        );

        let mut path_authority = DiagnosticAuthorityProjection::new(
            root.to_str().expect("root"),
            DiagnosticAuthorityLimits::default(),
        )
        .expect("path authority");
        for index in 0..MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES {
            let path = root.join(format!("{index}.ts"));
            fs::write(&path, index.to_string()).expect("fixture path");
            assert_eq!(
                path_authority.authorize_path(&path),
                AuthorityDecision::Allowed
            );
        }
        assert_eq!(
            path_authority.authorize_path(&root.join("overflow.ts")),
            AuthorityDecision::PathProbeLimit
        );
        assert_eq!(
            path_authority.path_probes_performed,
            MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn cached_inside_and_outside_decisions_survive_probe_exhaustion() {
        let root = workspace("cache-after-exhaustion");
        let outside = workspace("cache-outside");
        let inside_path = root.join("inside.ts");
        let outside_path = outside.join("outside.ts");
        fs::write(&inside_path, "inside").expect("inside");
        fs::write(&outside_path, "outside").expect("outside");
        let mut authority =
            DiagnosticAuthorityProjection::new(root.to_str().expect("root"), limits(8, 2))
                .expect("authority");

        assert_eq!(
            authority.authorize_path(&inside_path),
            AuthorityDecision::Allowed
        );
        assert_eq!(
            authority.authorize_path(&outside_path),
            AuthorityDecision::Rejected
        );
        assert_eq!(
            authority.authorize_path(&root.join("unseen.ts")),
            AuthorityDecision::PathProbeLimit
        );
        assert_eq!(
            authority.authorize_path(&inside_path),
            AuthorityDecision::Allowed
        );
        assert_eq!(
            authority.authorize_path(&outside_path),
            AuthorityDecision::Rejected
        );
        assert_eq!(authority.path_probes_performed, 2);
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(outside).expect("cleanup outside");
    }

    #[test]
    fn deeply_missing_path_never_exceeds_the_filesystem_observation_budget() {
        let root = workspace("deep-missing");
        let deep = (0..300).fold(root.clone(), |path, _| path.join("x"));
        let mut authority = DiagnosticAuthorityProjection::new(
            root.to_str().expect("root"),
            DiagnosticAuthorityLimits::default(),
        )
        .expect("authority");

        assert_eq!(
            authority.authorize_path(&deep),
            AuthorityDecision::PathProbeLimit
        );
        assert_eq!(
            authority.path_probes_performed,
            MAX_DIAGNOSTIC_AUTHORITY_FILESYSTEM_PROBES
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn publication_budget_exhaustion_removes_data_with_a_truthful_receipt() {
        let root = workspace("receipt");
        let source = root.join("source.ts");
        fs::write(&source, "export {};").expect("source");
        let uri = url::Url::from_file_path(source)
            .expect("source URI")
            .to_string();
        let event = || {
            parse_publish_diagnostics(
                &json!({
                    "method": "textDocument/publishDiagnostics",
                    "params": {
                        "uri": uri.clone(),
                        "diagnostics": [{
                            "range": {
                                "start": { "line": 0, "character": 0 },
                                "end": { "line": 0, "character": 1 }
                            },
                            "message": "bounded",
                            "data": {
                                "path": "first.ts",
                                "targetPath": "second.ts"
                            }
                        }]
                    }
                }),
                1,
            )
            .expect("diagnostic event")
        };

        for (exhausted_limits, expected_reason) in [
            (
                limits(2, 8),
                LanguageServerDiagnosticProjectionReason::AuthorityNode,
            ),
            (
                limits(8, 1),
                LanguageServerDiagnosticProjectionReason::PathProbe,
            ),
        ] {
            let filtered = filter_diagnostic_event_with_limits(
                root.to_str().expect("root"),
                event(),
                exhausted_limits,
            )
            .expect("filtered event");
            assert_eq!(filtered.diagnostics[0].data, None);
            let retained_utf8_bytes = serde_json::to_vec(&filtered.diagnostics)
                .expect("serialize diagnostics")
                .len();
            assert!(matches!(
                filtered.projection,
                LanguageServerDiagnosticProjection::Truncated {
                    omitted_count: 0,
                    ref reasons,
                    sanitized_field_count: 1,
                    retained_utf8_bytes: receipt_bytes,
                    ..
                } if reasons == &[expected_reason] && receipt_bytes == retained_utf8_bytes
            ));
        }
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn an_empty_publication_remains_complete_after_authority_filtering() {
        let root = workspace("empty");
        let source = root.join("source.ts");
        fs::write(&source, "export {};").expect("source");
        let uri = url::Url::from_file_path(source)
            .expect("source URI")
            .to_string();
        let event = parse_publish_diagnostics(
            &json!({
                "method": "textDocument/publishDiagnostics",
                "params": {
                    "uri": uri,
                    "diagnostics": []
                }
            }),
            1,
        )
        .expect("diagnostic event");

        let filtered = filter_diagnostic_event_to_workspace(root.to_str().expect("root"), event)
            .expect("filtered event");
        assert!(filtered.diagnostics.is_empty());
        assert!(matches!(
            filtered.projection,
            LanguageServerDiagnosticProjection::Complete {
                published_count: 0,
                retained_count: 0,
                retained_utf8_bytes: 2,
                ..
            }
        ));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
