use super::{
    record_ignore_rules_completeness, LocalWorkspaceMetadataScanner, MetadataScanReport,
    PRIVACY_PROTECTED_SKIP_REASON,
};
use crate::ignore_matcher::{
    GitignoreWorkspaceIgnoreMatcher, IgnoreRulesTruncation, ScopeDiscoveryLimits,
    WorkspaceIgnoreOptions,
};
use crate::workspace::protected_paths::ProtectedPathPolicy;
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_workspace(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("editor-scan-ignore-rules-{label}-{suffix}"));
    fs::create_dir_all(&root).expect("temp workspace");
    root.canonicalize().expect("canonical workspace")
}

#[cfg(target_os = "macos")]
#[test]
fn home_root_scan_skips_privacy_protected_children() {
    let home = temp_workspace("protected-home");
    fs::create_dir_all(home.join("Music")).expect("protected directory");
    fs::write(home.join("Music/track.ts"), "export {};").expect("protected file");
    fs::create_dir_all(home.join("code")).expect("regular directory");
    fs::write(home.join("code/index.ts"), "export {};").expect("regular file");
    let scanner = LocalWorkspaceMetadataScanner::default()
        .with_protected_paths(ProtectedPathPolicy::for_home(Some(&home)));

    let collection = scanner
        .collect_path_with_cancellation(&home, &home, &|| false)
        .expect("collect");

    assert_eq!(
        collection
            .records
            .iter()
            .map(|record| record.relative_path.as_str())
            .collect::<Vec<_>>(),
        vec!["code/index.ts"]
    );
    assert!(collection
        .report
        .skipped_details
        .iter()
        .any(|detail| detail.path == "Music" && detail.reason == PRIVACY_PROTECTED_SKIP_REASON));
}

#[cfg(target_os = "macos")]
#[test]
fn scan_rooted_at_a_protected_home_child_indexes_its_files() {
    let home = temp_workspace("protected-documents-root");
    let documents = home.join("Documents");
    fs::create_dir_all(documents.join("project")).expect("documents tree");
    fs::write(documents.join("project/index.ts"), "export {};").expect("document file");
    let scanner = LocalWorkspaceMetadataScanner::default()
        .with_protected_paths(ProtectedPathPolicy::for_home(Some(&home)));

    let collection = scanner
        .collect_path_with_cancellation(&documents, &documents, &|| false)
        .expect("collect");

    assert_eq!(collection.records.len(), 1);
    assert_eq!(collection.records[0].relative_path, "project/index.ts");
}

#[test]
fn truncated_ignore_rules_are_reported_in_the_scan_report() {
    let root = temp_workspace("ignore-truncated");
    for index in 0..3 {
        fs::create_dir_all(root.join(format!("dir-{index}"))).expect("directory");
    }
    let matcher = GitignoreWorkspaceIgnoreMatcher::load_with_options(
        &root,
        WorkspaceIgnoreOptions::default().with_discovery_limits(ScopeDiscoveryLimits {
            max_entries: 1,
            ..ScopeDiscoveryLimits::default()
        }),
    )
    .expect("matcher");
    let complete = GitignoreWorkspaceIgnoreMatcher::load(&root).expect("complete matcher");
    let mut truncated_report = MetadataScanReport::default();
    let mut complete_report = MetadataScanReport::default();

    record_ignore_rules_completeness(&mut truncated_report, &matcher);
    record_ignore_rules_completeness(&mut complete_report, &complete);

    assert_eq!(truncated_report.errored_entries, 1);
    assert_eq!(
        truncated_report.error_details[0].reason,
        IgnoreRulesTruncation::EntryLimit.description()
    );
    assert_eq!(complete_report, MetadataScanReport::default());
}
