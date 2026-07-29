use super::*;
use crate::{search::TextSearchOptions, workspace_registry::WorkspaceId};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
};

fn fixture(label: &str) -> (Arc<WorkspaceRegistry>, WorkspaceId, PathBuf) {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let root = std::env::temp_dir().join(format!(
        "codevo-workspace-search-{label}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).unwrap();
    let registry = Arc::new(WorkspaceRegistry::new());
    let id = registry.register(&root).unwrap().workspace_id;
    (registry, id, root)
}

#[test]
fn zero_budget_wide_directory_truncates_before_stat_or_name_allocation() {
    let (registry, id, root) = fixture("zero-wide");
    for index in 0..512 {
        fs::write(root.join(format!("entry-{index:04}.ts")), "").unwrap();
    }
    let root_file = registry.clone_root(&id).unwrap();
    let display_root = registry.descriptor(&id).unwrap().canonical_root_path;
    TEST_HOOK.with(|hook| {
        *hook.borrow_mut() = Some((
            "directory-entries-before-stat",
            Box::new(|_, _, _, _| panic!("zero-budget traversal must not stat an entry")),
        ));
    });

    let (results, truncated) = collect_ranked_files_with_truncation(
        &root_file,
        Path::new(""),
        "",
        10,
        0,
        &display_root,
        &|| true,
    )
    .unwrap();

    TEST_HOOK.with(|hook| *hook.borrow_mut() = None);
    assert!(results.is_empty());
    assert!(truncated);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn descriptor_walk_observes_cancellation_inside_a_wide_directory() {
    let (registry, id, root) = fixture("cancel-wide");
    for index in 0..512 {
        fs::write(root.join(format!("entry-{index:04}.ts")), "").unwrap();
    }
    let root_file = registry.clone_root(&id).unwrap();
    let display_root = registry.descriptor(&id).unwrap().canonical_root_path;
    let checks = AtomicUsize::new(0);

    let error = collect_ranked_files_with_truncation(
        &root_file,
        Path::new(""),
        "",
        10,
        WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
        &display_root,
        &|| checks.fetch_add(1, Ordering::SeqCst) < 4,
    )
    .unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    assert!(checks.load(Ordering::SeqCst) <= 5);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_column_uses_monaco_utf16_code_units_for_astral_prefixes() {
    let (registry, id, root) = fixture("utf16-column");
    fs::write(root.join("astral.ts"), "😀needle").unwrap();
    let repository = WorkspaceFileRepository::new(&registry);

    let response = repository
        .prepare_text_search(
            &id,
            Path::new(""),
            "needle",
            20,
            &TextSearchOptions::default(),
        )
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert!(!response.truncated);
    assert_eq!(response.results.len(), 1);
    let result = &response.results[0];
    assert_eq!(result.column, 3);
    assert_eq!(result.line_text, "😀needle");
    assert_eq!((result.match_start, result.match_end), (1, 7));
    assert!(!result.preview_truncated);
    assert!(!result.match_truncated);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_preview_is_utf8_safe_bounded_and_keeps_the_match_visible() {
    let (registry, id, root) = fixture("utf8-preview");
    let line = format!("{}needle{}", "😀".repeat(3_000), "ž".repeat(3_000));
    fs::write(root.join("unicode.ts"), &line).unwrap();
    let repository = WorkspaceFileRepository::new(&registry);

    let response = repository
        .prepare_text_search(
            &id,
            Path::new(""),
            "needle",
            20,
            &TextSearchOptions::default(),
        )
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert!(!response.truncated);
    assert_eq!(response.results.len(), 1);
    let result = &response.results[0];
    assert_eq!(result.column, 6_001);
    assert!(result.preview_truncated);
    assert!(!result.match_truncated);
    assert!(result.line_text.len() <= WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT);
    let highlighted = result
        .line_text
        .chars()
        .skip(result.match_start as usize)
        .take((result.match_end - result.match_start) as usize)
        .collect::<String>();
    assert_eq!(highlighted, "needle");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_aggregate_byte_cap_is_truthfully_truncated() {
    let (registry, id, root) = fixture("response-cap");
    let long_name = format!("{}.ts", "a".repeat(180));
    let line = format!(
        "needle{}",
        "x".repeat(WORKSPACE_TEXT_SEARCH_PREVIEW_BYTE_LIMIT - 6)
    );
    let content = std::iter::repeat_n(line, 500)
        .collect::<Vec<_>>()
        .join("\n");
    fs::write(root.join(long_name), content).unwrap();
    let repository = WorkspaceFileRepository::new(&registry);

    let response = repository
        .prepare_text_search(
            &id,
            Path::new(""),
            "needle",
            500,
            &TextSearchOptions::default(),
        )
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert!(response.truncated);
    assert!(response.results.len() < 500);
    let serialized_items = response
        .results
        .iter()
        .map(|result| serde_json::to_vec(result).unwrap().len() + 1)
        .sum::<usize>();
    assert!(
        serialized_items + workspace_file_search::SEARCH_RESPONSE_ENVELOPE_RESERVE_BYTES
            <= WORKSPACE_TEXT_SEARCH_RESPONSE_BYTE_LIMIT
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn matching_result_limit_is_truthfully_truncated() {
    let (registry, id, root) = fixture("matching-limit");
    fs::write(root.join("match-a.ts"), "").unwrap();
    fs::write(root.join("match-b.ts"), "").unwrap();
    let results = WorkspaceFileRepository::new(&registry)
        .search_files(&id, Path::new(""), "match", 1)
        .unwrap();

    assert_eq!(results.len(), 1);
    assert!(results[0].truncated);
    fs::remove_dir_all(root).unwrap();
}
