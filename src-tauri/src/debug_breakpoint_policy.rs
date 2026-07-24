use crate::debug_adapter::{DebugBreakpoint, DebugLaunchTarget};
use crate::debug_hit_condition::PHP_HIT_CONDITION_UNSUPPORTED_ERROR;
use crate::debug_logpoint::{parse_debug_log_template, PHP_LOGPOINT_UNSUPPORTED_ERROR};
use crate::debug_support::validate_workspace_file;
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub(crate) const MAX_BREAKPOINTS_PER_SESSION: usize = 2_000;
pub(crate) const MAX_BREAKPOINTS_PER_FILE: usize = 512;
const MAX_BREAKPOINT_ID_BYTES: usize = 128;
const MAX_BREAKPOINT_PATH_BYTES: usize = 4_096;
const MAX_BREAKPOINT_CONDITION_BYTES: usize = 4_096;
pub(crate) const PHP_INLINE_BREAKPOINT_UNSUPPORTED_ERROR: &str =
    "Inline breakpoints are only available for Node.js debug sessions.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DebugBreakpointAdapterKind {
    Node,
    Php,
}

impl DebugBreakpointAdapterKind {
    pub(crate) fn from_launch(launch: &DebugLaunchTarget) -> Self {
        if launch.is_node() {
            Self::Node
        } else {
            Self::Php
        }
    }

    pub(crate) fn supports(self, path: &Path) -> bool {
        let extension = path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase);
        match self {
            Self::Node => matches!(
                extension.as_deref(),
                Some("js" | "jsx" | "ts" | "tsx" | "mjs" | "cjs" | "mts" | "cts")
            ),
            Self::Php => extension.as_deref() == Some("php"),
        }
    }
}

/// Validates every persisted breakpoint before capability filtering. This is
/// intentional: an unsupported-language entry must not become a vehicle for an
/// oversized payload or a workspace escape merely because the adapter ignores it.
pub(crate) fn validate_initial_breakpoints(
    root: &Path,
    kind: DebugBreakpointAdapterKind,
    breakpoints: &[DebugBreakpoint],
) -> Result<Vec<DebugBreakpoint>, String> {
    validate_array_bound(breakpoints.len(), MAX_BREAKPOINTS_PER_SESSION, "session")?;
    validate_unique_ids(breakpoints)?;

    let mut per_file = HashMap::<String, usize>::new();
    let mut validated = Vec::with_capacity(breakpoints.len());
    for breakpoint in breakpoints {
        validate_breakpoint_fields(breakpoint)?;
        validate_inline_breakpoint_capability(kind, breakpoint)?;
        validate_hit_condition_capability(kind, breakpoint)?;
        validate_logpoint_capability(kind, breakpoint)?;
        let canonical = validate_breakpoint_file(root, &breakpoint.file_path)?;
        let count = per_file.entry(canonical.clone()).or_default();
        *count += 1;
        validate_array_bound(*count, MAX_BREAKPOINTS_PER_FILE, "file")?;
        if kind.supports(Path::new(&canonical)) {
            let mut normalized = breakpoint.clone();
            normalized.file_path = canonical;
            validated.push(normalized);
        }
    }
    Ok(validated)
}

pub(crate) fn validate_live_breakpoints(
    root: &Path,
    kind: DebugBreakpointAdapterKind,
    command_file_path: &str,
    breakpoints: &[DebugBreakpoint],
    current_session_count: usize,
    current_file_count: usize,
    other_file_ids: &HashSet<String>,
) -> Result<(String, Vec<DebugBreakpoint>), String> {
    validate_bounded_text(
        command_file_path,
        MAX_BREAKPOINT_PATH_BYTES,
        "Breakpoint file path",
    )?;
    let canonical = validate_breakpoint_file(root, command_file_path)?;
    if !kind.supports(Path::new(&canonical)) {
        return Err("The active debugger does not support breakpoints for this file type.".into());
    }
    validate_array_bound(breakpoints.len(), MAX_BREAKPOINTS_PER_FILE, "file")?;
    let replacement_total = current_session_count
        .saturating_sub(current_file_count)
        .saturating_add(breakpoints.len());
    validate_array_bound(replacement_total, MAX_BREAKPOINTS_PER_SESSION, "session")?;
    validate_unique_ids(breakpoints)?;
    if let Some(duplicate) = breakpoints
        .iter()
        .find(|breakpoint| other_file_ids.contains(&breakpoint.id))
    {
        return Err(format!("Duplicate breakpoint id `{}`.", duplicate.id));
    }

    let mut normalized = Vec::with_capacity(breakpoints.len());
    for breakpoint in breakpoints {
        validate_breakpoint_fields(breakpoint)?;
        validate_inline_breakpoint_capability(kind, breakpoint)?;
        validate_hit_condition_capability(kind, breakpoint)?;
        validate_logpoint_capability(kind, breakpoint)?;
        if breakpoint.file_path != command_file_path {
            return Err("Every breakpoint file path must match the command file path.".into());
        }
        let mut breakpoint = breakpoint.clone();
        breakpoint.file_path.clone_from(&canonical);
        normalized.push(breakpoint);
    }
    Ok((canonical, normalized))
}

pub(crate) fn breakpoints_by_file(
    breakpoints: &[DebugBreakpoint],
) -> HashMap<String, Vec<DebugBreakpoint>> {
    let mut grouped = HashMap::<String, Vec<DebugBreakpoint>>::new();
    for breakpoint in breakpoints {
        grouped
            .entry(breakpoint.file_path.clone())
            .or_default()
            .push(breakpoint.clone());
    }
    grouped
}

pub(crate) fn prepare_live_breakpoints(
    root: &Path,
    kind: DebugBreakpointAdapterKind,
    stored: &HashMap<String, Vec<DebugBreakpoint>>,
    file_path: &str,
    breakpoints: &[DebugBreakpoint],
) -> Result<(String, Vec<DebugBreakpoint>), String> {
    let session_count = stored.values().map(Vec::len).sum();
    let canonical_candidate = validate_workspace_file(root, file_path)?;
    let current_file_count = stored
        .get(&canonical_candidate)
        .map(Vec::len)
        .unwrap_or_default();
    let other_file_ids = stored
        .iter()
        .filter(|(path, _)| *path != &canonical_candidate)
        .flat_map(|(_, entries)| entries.iter().map(|entry| entry.id.clone()))
        .collect();
    validate_live_breakpoints(
        root,
        kind,
        file_path,
        breakpoints,
        session_count,
        current_file_count,
        &other_file_ids,
    )
}

pub(crate) fn commit_live_breakpoints(
    stored: &mut HashMap<String, Vec<DebugBreakpoint>>,
    canonical_file_path: String,
    normalized: Vec<DebugBreakpoint>,
) {
    if normalized.is_empty() {
        stored.remove(&canonical_file_path);
    } else {
        stored.insert(canonical_file_path, normalized);
    }
}

fn validate_unique_ids(breakpoints: &[DebugBreakpoint]) -> Result<(), String> {
    let mut ids = HashSet::with_capacity(breakpoints.len());
    for breakpoint in breakpoints {
        if !ids.insert(breakpoint.id.as_str()) {
            return Err(format!("Duplicate breakpoint id `{}`.", breakpoint.id));
        }
    }
    Ok(())
}

fn validate_breakpoint_fields(breakpoint: &DebugBreakpoint) -> Result<(), String> {
    validate_bounded_text(&breakpoint.id, MAX_BREAKPOINT_ID_BYTES, "Breakpoint id")?;
    if breakpoint.id.is_empty() {
        return Err("Breakpoint id must not be empty.".into());
    }
    validate_bounded_text(
        &breakpoint.file_path,
        MAX_BREAKPOINT_PATH_BYTES,
        "Breakpoint file path",
    )?;
    if breakpoint.file_path.is_empty() {
        return Err("Breakpoint file path must not be empty.".into());
    }
    if breakpoint.line_number == 0 {
        return Err("Breakpoint line number must be at least 1.".into());
    }
    if breakpoint.column_number == Some(0) {
        return Err("Inline breakpoint column number must be at least 1.".into());
    }
    if let Some(condition) = &breakpoint.condition {
        validate_bounded_text(
            condition,
            MAX_BREAKPOINT_CONDITION_BYTES,
            "Breakpoint condition",
        )?;
    }
    if let Some(hit_condition) = breakpoint.hit_condition {
        hit_condition.validate()?;
    }
    if let Some(log_message) = &breakpoint.log_message {
        parse_debug_log_template(log_message)?;
    }
    Ok(())
}

fn validate_inline_breakpoint_capability(
    kind: DebugBreakpointAdapterKind,
    breakpoint: &DebugBreakpoint,
) -> Result<(), String> {
    if kind == DebugBreakpointAdapterKind::Php && breakpoint.column_number.is_some() {
        return Err(PHP_INLINE_BREAKPOINT_UNSUPPORTED_ERROR.into());
    }
    Ok(())
}

fn validate_logpoint_capability(
    kind: DebugBreakpointAdapterKind,
    breakpoint: &DebugBreakpoint,
) -> Result<(), String> {
    if kind == DebugBreakpointAdapterKind::Php && breakpoint.log_message.is_some() {
        return Err(PHP_LOGPOINT_UNSUPPORTED_ERROR.into());
    }
    Ok(())
}

fn validate_hit_condition_capability(
    kind: DebugBreakpointAdapterKind,
    breakpoint: &DebugBreakpoint,
) -> Result<(), String> {
    if kind == DebugBreakpointAdapterKind::Php && breakpoint.hit_condition.is_some() {
        return Err(PHP_HIT_CONDITION_UNSUPPORTED_ERROR.into());
    }
    Ok(())
}

fn validate_breakpoint_file(root: &Path, file_path: &str) -> Result<String, String> {
    validate_workspace_file(root, file_path).map_err(|error| format!("Invalid breakpoint: {error}"))
}

fn validate_bounded_text(value: &str, maximum: usize, label: &str) -> Result<(), String> {
    if value.len() > maximum {
        return Err(format!("{label} exceeds the {maximum}-byte limit."));
    }
    if value.contains('\0') {
        return Err(format!("{label} must not contain NUL bytes."));
    }
    Ok(())
}

fn validate_array_bound(actual: usize, maximum: usize, scope: &str) -> Result<(), String> {
    if actual > maximum {
        return Err(format!(
            "A debug {scope} supports at most {maximum} breakpoints."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug_hit_condition::DebugHitCondition;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        root: std::path::PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "codevo-breakpoint-policy-{}-{}",
                std::process::id(),
                NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&root).expect("create fixture root");
            Self { root }
        }

        fn file(&self, name: &str) -> String {
            let path = self.root.join(name);
            fs::write(&path, "test").expect("write fixture file");
            path.to_string_lossy().into_owned()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn breakpoint(file_path: &str, id: impl Into<String>) -> DebugBreakpoint {
        DebugBreakpoint {
            id: id.into(),
            file_path: file_path.to_string(),
            line_number: 1,
            column_number: None,
            condition: None,
            hit_condition: None,
            log_message: None,
            enabled: true,
            verified: false,
        }
    }

    #[test]
    fn initial_policy_filters_unsupported_language_after_security_validation() {
        let fixture = Fixture::new();
        let js = fixture.file("app.ts");
        let php = fixture.file("index.php");
        let validated = validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[breakpoint(&js, "js"), breakpoint(&php, "php")],
        )
        .expect("validate mixed persisted breakpoints");

        let canonical_js = fs::canonicalize(&js)
            .expect("canonical js fixture")
            .to_string_lossy()
            .into_owned();
        assert_eq!(validated, vec![breakpoint(&canonical_js, "js")]);

        let php_validated = validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Php,
            &[breakpoint(&js, "js"), breakpoint(&php, "php")],
        )
        .expect("validate php capability filtering");
        let canonical_php = fs::canonicalize(&php)
            .expect("canonical php fixture")
            .to_string_lossy()
            .into_owned();
        assert_eq!(php_validated, vec![breakpoint(&canonical_php, "php")]);
    }

    #[test]
    fn node_accepts_but_php_explicitly_rejects_hit_conditions() {
        let fixture = Fixture::new();
        let js = fixture.file("app.ts");
        let php = fixture.file("index.php");
        let mut node_breakpoint = breakpoint(&js, "node-hit");
        node_breakpoint.hit_condition = Some(DebugHitCondition::Multiple { count: 2 });
        assert!(validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[node_breakpoint]
        )
        .is_ok());

        let mut php_breakpoint = breakpoint(&php, "php-hit");
        php_breakpoint.hit_condition = Some(DebugHitCondition::Equals { count: 2 });
        assert_eq!(
            validate_initial_breakpoints(
                &fixture.root,
                DebugBreakpointAdapterKind::Php,
                &[php_breakpoint.clone()]
            )
            .unwrap_err(),
            "Hit conditions are only available for Node.js breakpoints."
        );
        assert_eq!(
            validate_live_breakpoints(
                &fixture.root,
                DebugBreakpointAdapterKind::Php,
                &php,
                &[php_breakpoint],
                0,
                0,
                &HashSet::new(),
            )
            .unwrap_err(),
            "Hit conditions are only available for Node.js breakpoints."
        );
    }

    #[test]
    fn node_accepts_but_php_explicitly_rejects_inline_columns() {
        let fixture = Fixture::new();
        let js = fixture.file("app.ts");
        let php = fixture.file("index.php");
        let mut node_breakpoint = breakpoint(&js, "node-inline");
        node_breakpoint.column_number = Some(u32::MAX);
        assert!(validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[node_breakpoint]
        )
        .is_ok());

        let mut php_breakpoint = breakpoint(&php, "php-inline");
        php_breakpoint.column_number = Some(7);
        assert_eq!(
            validate_initial_breakpoints(
                &fixture.root,
                DebugBreakpointAdapterKind::Php,
                &[php_breakpoint.clone()]
            )
            .unwrap_err(),
            PHP_INLINE_BREAKPOINT_UNSUPPORTED_ERROR
        );
        assert_eq!(
            validate_live_breakpoints(
                &fixture.root,
                DebugBreakpointAdapterKind::Php,
                &php,
                &[php_breakpoint],
                0,
                0,
                &HashSet::new(),
            )
            .unwrap_err(),
            PHP_INLINE_BREAKPOINT_UNSUPPORTED_ERROR
        );

        let mut invalid = breakpoint(&js, "zero-inline");
        invalid.column_number = Some(0);
        assert!(validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[invalid]
        )
        .unwrap_err()
        .contains("at least 1"));
    }

    #[test]
    fn node_validates_and_php_explicitly_rejects_logpoints() {
        let fixture = Fixture::new();
        let js = fixture.file("app.ts");
        let php = fixture.file("index.php");
        let mut node = breakpoint(&js, "node-log");
        node.log_message = Some("count={count}".into());
        assert!(validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[node]
        )
        .is_ok());

        let mut malformed = breakpoint(&js, "bad-log");
        malformed.log_message = Some("count={".into());
        assert!(validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[malformed]
        )
        .unwrap_err()
        .contains("unmatched"));

        let mut php_log = breakpoint(&php, "php-log");
        php_log.log_message = Some("never".into());
        assert_eq!(
            validate_initial_breakpoints(
                &fixture.root,
                DebugBreakpointAdapterKind::Php,
                &[php_log.clone()]
            )
            .unwrap_err(),
            "Logpoints are only available for Node.js breakpoints."
        );
        assert_eq!(
            validate_live_breakpoints(
                &fixture.root,
                DebugBreakpointAdapterKind::Php,
                &php,
                &[php_log],
                0,
                0,
                &HashSet::new(),
            )
            .unwrap_err(),
            "Logpoints are only available for Node.js breakpoints."
        );
    }

    #[test]
    fn initial_policy_rejects_invalid_unsupported_entries_before_filtering() {
        let fixture = Fixture::new();
        let outside = std::env::temp_dir().join(format!(
            "codevo-breakpoint-outside-{}-{}.php",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&outside, "<?php").expect("write outside file");
        let result = validate_initial_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &[breakpoint(&outside.to_string_lossy(), "outside")],
        );
        let _ = fs::remove_file(outside);

        assert!(result.unwrap_err().contains("outside the workspace"));
    }

    #[test]
    fn live_policy_requires_matching_paths_positive_lines_and_unique_ids() {
        let fixture = Fixture::new();
        let file = fixture.file("app.js");
        let other = fixture.file("other.js");
        let no_ids = HashSet::new();

        let mismatch = validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&other, "one")],
            0,
            0,
            &no_ids,
        );
        assert!(mismatch.unwrap_err().contains("must match"));

        let mut zero = breakpoint(&file, "zero");
        zero.line_number = 0;
        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[zero],
            0,
            0,
            &no_ids,
        )
        .unwrap_err()
        .contains("at least 1"));

        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "same"), breakpoint(&file, "same")],
            0,
            0,
            &no_ids,
        )
        .unwrap_err()
        .contains("Duplicate"));
    }

    #[test]
    fn live_policy_enforces_cross_file_identity_and_all_payload_limits() {
        let fixture = Fixture::new();
        let file = fixture.file("app.tsx");
        let mut occupied = HashSet::new();
        occupied.insert("existing".to_string());

        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "existing")],
            1,
            0,
            &occupied,
        )
        .unwrap_err()
        .contains("Duplicate"));

        let mut oversized_id = breakpoint(&file, "x".repeat(MAX_BREAKPOINT_ID_BYTES + 1));
        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[oversized_id.clone()],
            0,
            0,
            &HashSet::new(),
        )
        .unwrap_err()
        .contains("128-byte"));
        oversized_id.id = "valid".into();
        oversized_id.condition = Some("x".repeat(MAX_BREAKPOINT_CONDITION_BYTES + 1));
        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[oversized_id],
            0,
            0,
            &HashSet::new(),
        )
        .unwrap_err()
        .contains("4096-byte"));

        let too_many = (0..=MAX_BREAKPOINTS_PER_FILE)
            .map(|index| breakpoint(&file, format!("bp-{index}")))
            .collect::<Vec<_>>();
        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &too_many,
            0,
            0,
            &HashSet::new(),
        )
        .unwrap_err()
        .contains("512"));

        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[breakpoint(&file, "limit")],
            MAX_BREAKPOINTS_PER_SESSION,
            0,
            &HashSet::new(),
        )
        .unwrap_err()
        .contains("2000"));
    }

    #[test]
    fn empty_removal_still_requires_a_safe_supported_existing_file() {
        let fixture = Fixture::new();
        let file = fixture.file("app.mts");
        let (canonical, breakpoints) = validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &file,
            &[],
            1,
            1,
            &HashSet::new(),
        )
        .expect("safe removal");
        assert_eq!(
            canonical,
            fs::canonicalize(&file)
                .expect("canonical fixture")
                .to_string_lossy()
        );
        assert!(breakpoints.is_empty());

        let missing = fixture
            .root
            .join("missing.ts")
            .to_string_lossy()
            .into_owned();
        assert!(validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &missing,
            &[],
            1,
            1,
            &HashSet::new(),
        )
        .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new();
        let outside = std::env::temp_dir().join(format!(
            "codevo-breakpoint-symlink-{}-{}.ts",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::write(&outside, "test").expect("write outside file");
        let link = fixture.root.join("escape.ts");
        symlink(&outside, &link).expect("create symlink");

        let result = validate_live_breakpoints(
            &fixture.root,
            DebugBreakpointAdapterKind::Node,
            &link.to_string_lossy(),
            &[],
            0,
            0,
            &HashSet::new(),
        );
        let _ = fs::remove_file(outside);
        assert!(result.unwrap_err().contains("outside the workspace"));
    }
}
