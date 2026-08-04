use super::file_index::{
    IndexRejection, VisitedDirectory, WorkspaceFileIndexBounds, WorkspaceFileIndexBuilder,
    WorkspaceFileIndexKey,
};
use super::*;
use crate::{search::TextSearchOptions, workspace_registry::WorkspaceId};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc,
    },
    thread,
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

fn target_root(label: &str) -> PathBuf {
    static NEXT_TARGET: AtomicU64 = AtomicU64::new(1);
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("workspace-file-index-tests")
        .join(format!(
            "{label}-{}-{}",
            std::process::id(),
            NEXT_TARGET.fetch_add(1, Ordering::Relaxed)
        ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn indexing_cache() -> WorkspaceFileIndexCache {
    WorkspaceFileIndexCache::with_bounds(indexing_bounds())
}

fn indexing_bounds() -> WorkspaceFileIndexBounds {
    WorkspaceFileIndexBounds::default().with_mtime_settle_nanoseconds(0)
}

fn indexed_fixture(label: &str) -> (Arc<WorkspaceRegistry>, WorkspaceId, PathBuf) {
    let root = target_root(label);
    let registry = Arc::new(WorkspaceRegistry::new());
    let id = registry.register(&root).unwrap().workspace_id;
    (registry, id, root)
}

fn write_monorepo_tree(root: &Path) {
    fs::create_dir_all(root.join("src/components")).unwrap();
    fs::create_dir_all(root.join("docs")).unwrap();
    fs::create_dir_all(root.join("node_modules/left-pad")).unwrap();
    fs::write(root.join(".gitignore"), "ignored-*\n").unwrap();
    fs::write(root.join("package.json"), "{}").unwrap();
    fs::write(root.join("index.ts"), "").unwrap();
    fs::write(root.join("src/app.ts"), "").unwrap();
    fs::write(root.join("src/app.test.ts"), "").unwrap();
    fs::write(root.join("src/ignored-secret.ts"), "").unwrap();
    fs::write(root.join("src/components/Button.tsx"), "").unwrap();
    fs::write(root.join("src/components/button.helpers.ts"), "").unwrap();
    fs::write(root.join("docs/readme.md"), "").unwrap();
    fs::write(root.join("node_modules/left-pad/index.js"), "").unwrap();
}

const PROPERTY_QUERIES: &[&str] = &[
    "",
    "app",
    "button",
    "ts",
    "src/app",
    "Button.tsx",
    "index",
    "package",
    "readme",
    "secret",
    "zzz-no-match",
    "app test",
    "b h",
];

type SearchProjection = Vec<(String, String)>;

fn project(results: &[DescriptorFileSearchResult]) -> SearchProjection {
    results
        .iter()
        .map(|result| (result.name.clone(), result.relative_path.clone()))
        .collect()
}

fn search(
    registry: &WorkspaceRegistry,
    cache: &WorkspaceFileIndexCache,
    id: &WorkspaceId,
    scope: &Path,
    query: &str,
    limit: usize,
) -> SearchProjection {
    let results = WorkspaceFileRepository::new(registry)
        .prepare_file_search(cache, id, scope, query, limit)
        .unwrap()
        .execute(&|| true)
        .unwrap();
    project(&results.results)
}

fn crawled(
    registry: &WorkspaceRegistry,
    id: &WorkspaceId,
    scope: &Path,
    query: &str,
    limit: usize,
) -> SearchProjection {
    search(
        registry,
        &WorkspaceFileIndexCache::new(),
        id,
        scope,
        query,
        limit,
    )
}

fn warm_index(
    registry: &WorkspaceRegistry,
    cache: &WorkspaceFileIndexCache,
    id: &WorkspaceId,
) -> SearchProjection {
    let served = search(registry, cache, id, Path::new(""), "", 80);
    assert_eq!(
        cache.retained_index_count(),
        1,
        "the first query must retain a bounded index (rejection: {:?})",
        cache.last_rejection()
    );
    served
}

#[test]
fn index_served_queries_match_a_fresh_crawl_on_the_same_tree() {
    let (registry, id, root) = indexed_fixture("crawl-parity");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    for query in PROPERTY_QUERIES {
        for limit in [1usize, 3, 80] {
            let expected = crawled(&registry, &id, Path::new(""), query, limit);
            let served = search(&registry, &cache, &id, Path::new(""), query, limit);
            assert_eq!(
                served, expected,
                "index result diverged from the crawl for {query:?} at limit {limit}"
            );
        }
    }
    assert!(cache.index_hit_count() >= PROPERTY_QUERIES.len() * 3);
    assert_eq!(cache.crawl_count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn index_served_queries_match_a_fresh_crawl_for_non_ascii_paths_and_queries() {
    let (registry, id, root) = indexed_fixture("non-ascii-parity");
    fs::write(root.join("café.ts"), "").unwrap();
    fs::write(root.join("Übersicht.md"), "").unwrap();
    fs::write(root.join("plain.ts"), "").unwrap();
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    for query in ["caf", "café", "übersicht", "Ü", "plain", "zzz-no-match"] {
        let expected = crawled(&registry, &id, Path::new(""), query, 80);
        let served = search(&registry, &cache, &id, Path::new(""), query, 80);
        assert_eq!(
            served, expected,
            "index result diverged from the crawl for {query:?}"
        );
    }
    let ascii_query_over_non_ascii_path = search(&registry, &cache, &id, Path::new(""), "caf", 80);
    assert!(ascii_query_over_non_ascii_path
        .iter()
        .any(|(name, _)| name.starts_with("caf")));
    assert_eq!(cache.crawl_count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn parallel_index_serving_matches_a_fresh_crawl_above_the_worker_threshold() {
    let (registry, id, root) = indexed_fixture("parallel-parity");
    for package in 0..30 {
        let source = root.join(format!("packages/pkg-{package:02}/src"));
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("moduleA.ts"), "").unwrap();
        fs::write(source.join("index.ts"), "").unwrap();
        for file in 0..40 {
            fs::write(source.join(format!("file-{file:03}.ts")), "").unwrap();
        }
    }
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    for query in [
        "",
        "file",
        "file-01",
        "moduleA",
        "pkg-2",
        "pkg src",
        "zzz-no-match",
        "MODULEA.TS",
    ] {
        for limit in [1usize, 3, 80] {
            let expected = crawled(&registry, &id, Path::new(""), query, limit);
            let served = search(&registry, &cache, &id, Path::new(""), query, limit);
            assert_eq!(
                served, expected,
                "parallel index result diverged from the crawl for {query:?} at limit {limit}"
            );
        }
    }
    assert_eq!(cache.crawl_count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_path_byte_bound_charges_lowered_ascii_bytes_at_an_exact_boundary() {
    let ascii_cost = "ab.ts".len() * 3;
    let mut accepted =
        WorkspaceFileIndexBuilder::new(indexing_bounds().with_path_bytes(ascii_cost));
    accepted.record_file(Path::new("ab.ts"), "ab.ts");
    assert!(accepted.finish(false, false).is_ok());

    let mut rejected =
        WorkspaceFileIndexBuilder::new(indexing_bounds().with_path_bytes(ascii_cost - 1));
    rejected.record_file(Path::new("ab.ts"), "ab.ts");
    assert_eq!(
        rejected.finish(false, false).err(),
        Some(IndexRejection::PathByteLimit)
    );

    let non_ascii_cost = "é.ts".len() * 2;
    let mut without_lowered =
        WorkspaceFileIndexBuilder::new(indexing_bounds().with_path_bytes(non_ascii_cost));
    without_lowered.record_file(Path::new("é.ts"), "é.ts");
    assert!(without_lowered.finish(false, false).is_ok());

    let mut non_ascii_rejected =
        WorkspaceFileIndexBuilder::new(indexing_bounds().with_path_bytes(non_ascii_cost - 1));
    non_ascii_rejected.record_file(Path::new("é.ts"), "é.ts");
    assert_eq!(
        non_ascii_rejected.finish(false, false).err(),
        Some(IndexRejection::PathByteLimit)
    );
}

#[test]
fn a_superseded_parallel_rank_scan_fails_closed_at_every_check_boundary() {
    let (registry, id, root) = indexed_fixture("parallel-supersession");
    for package in 0..30 {
        let source = root.join(format!("packages/pkg-{package:02}/src"));
        fs::create_dir_all(&source).unwrap();
        for file in 0..40 {
            fs::write(source.join(format!("file-{file:03}.ts")), "").unwrap();
        }
    }
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    let unrestricted = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&cache, &id, Path::new(""), "file", 80)
        .unwrap()
        .execute(&|| true);
    assert_eq!(unrestricted.unwrap().results.len(), 80);

    for deny_after in 0..6usize {
        let checks = AtomicUsize::new(0);
        let result = WorkspaceFileRepository::new(&registry)
            .prepare_file_search(&cache, &id, Path::new(""), "file", 80)
            .unwrap()
            .execute(&|| checks.fetch_add(1, Ordering::Relaxed) < deny_after);
        assert!(
            result.is_err(),
            "a query superseded after {deny_after} authority check(s) must fail closed"
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn index_serving_matches_the_raw_ranked_crawl_order() {
    let (registry, id, root) = indexed_fixture("ranked-order");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);
    let root_file = registry.clone_root(&id).unwrap();
    let display_root = registry.descriptor(&id).unwrap().canonical_root_path;

    let (expected, truncated) = collect_ranked_files_with_truncation(
        &root_file,
        Path::new(""),
        "button",
        80,
        WORKSPACE_FILE_SEARCH_VISITED_LIMIT,
        &display_root,
        &|| true,
    )
    .unwrap();
    let served = search(&registry, &cache, &id, Path::new(""), "button", 80);

    assert!(!truncated);
    assert_eq!(
        served
            .iter()
            .map(|(_, relative_path)| relative_path.clone())
            .collect::<Vec<_>>(),
        expected
            .iter()
            .map(|(path, _)| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_scoped_search_never_reuses_the_workspace_root_index() {
    let (registry, id, root) = indexed_fixture("scope-isolation");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    let scoped = search(&registry, &cache, &id, Path::new("src"), "", 80);

    assert_eq!(scoped, crawled(&registry, &id, Path::new("src"), "", 80));
    assert_eq!(cache.retained_index_count(), 2);
    assert!(scoped
        .iter()
        .all(|(_, relative_path)| !relative_path.contains("readme")));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_replaced_workspace_generation_never_serves_the_previous_index() {
    let (registry, first_id, root) = indexed_fixture("generation");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &first_id);

    registry.unregister(&first_id).unwrap();
    fs::write(root.join("src/reopened.ts"), "").unwrap();
    let second_id = registry.register(&root).unwrap().workspace_id;
    assert_ne!(first_id, second_id);
    let hits_before = cache.index_hit_count();
    let served = search(&registry, &cache, &second_id, Path::new(""), "reopened", 80);

    assert_eq!(cache.index_hit_count(), hits_before);
    assert_eq!(
        served,
        crawled(&registry, &second_id, Path::new(""), "reopened", 80)
    );
    assert_eq!(served.len(), 1);
    assert!(WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&cache, &first_id, Path::new(""), "", 80)
        .is_err());
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_external_file_creation_invalidates_the_index_before_the_next_query() {
    let (registry, id, root) = indexed_fixture("external-create");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    fs::write(root.join("src/components/created.tsx"), "").unwrap();
    let served = search(&registry, &cache, &id, Path::new(""), "created", 80);

    assert_eq!(
        served,
        crawled(&registry, &id, Path::new(""), "created", 80)
    );
    assert_eq!(served.len(), 1);
    assert_eq!(cache.crawl_count(), 2);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_external_file_removal_invalidates_the_index_before_the_next_query() {
    let (registry, id, root) = indexed_fixture("external-remove");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);
    assert_eq!(
        search(&registry, &cache, &id, Path::new(""), "readme", 80).len(),
        1
    );

    fs::remove_file(root.join("docs/readme.md")).unwrap();
    let served = search(&registry, &cache, &id, Path::new(""), "readme", 80);

    assert!(served.is_empty());
    assert_eq!(served, crawled(&registry, &id, Path::new(""), "readme", 80));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_gitignore_edit_changes_index_served_results() {
    let (registry, id, root) = indexed_fixture("gitignore-edit");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);
    assert!(search(&registry, &cache, &id, Path::new(""), "secret", 80).is_empty());

    fs::write(root.join(".gitignore"), "# nothing is ignored anymore\n").unwrap();
    let served = search(&registry, &cache, &id, Path::new(""), "secret", 80);

    assert_eq!(served, crawled(&registry, &id, Path::new(""), "secret", 80));
    assert_eq!(served.len(), 1);
    assert_eq!(served[0].1, "src/ignored-secret.ts");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_new_nested_gitignore_invalidates_the_index() {
    let (registry, id, root) = indexed_fixture("gitignore-added");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);
    assert_eq!(
        search(&registry, &cache, &id, Path::new(""), "button", 80).len(),
        2
    );

    fs::write(root.join("src/components/.gitignore"), "Button.tsx\n").unwrap();
    let served = search(&registry, &cache, &id, Path::new(""), "button", 80);

    assert_eq!(served, crawled(&registry, &id, Path::new(""), "button", 80));
    assert_eq!(served.len(), 1);
    assert_eq!(served[0].1, "src/components/button.helpers.ts");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn an_entry_cap_overflow_falls_back_to_the_crawl_without_truncating_results() {
    let (registry, id, root) = indexed_fixture("entry-cap");
    write_monorepo_tree(&root);
    let cache = WorkspaceFileIndexCache::with_bounds(indexing_bounds().with_files(2));

    for _ in 0..3 {
        let served = search(&registry, &cache, &id, Path::new(""), "", 80);
        assert_eq!(served, crawled(&registry, &id, Path::new(""), "", 80));
    }

    assert_eq!(cache.retained_index_count(), 0);
    assert_eq!(cache.index_hit_count(), 0);
    assert_eq!(cache.crawl_count(), 3);
    assert_eq!(cache.last_rejection(), Some(IndexRejection::FileLimit));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_directory_cap_overflow_falls_back_to_the_crawl() {
    let (registry, id, root) = indexed_fixture("directory-cap");
    write_monorepo_tree(&root);
    let cache = WorkspaceFileIndexCache::with_bounds(indexing_bounds().with_directories(1));

    let served = search(&registry, &cache, &id, Path::new(""), "", 80);

    assert_eq!(served, crawled(&registry, &id, Path::new(""), "", 80));
    assert_eq!(cache.retained_index_count(), 0);
    assert_eq!(cache.last_rejection(), Some(IndexRejection::DirectoryLimit));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_truncated_walk_is_never_retained_as_an_index() {
    let (registry, id, root) = indexed_fixture("truncated-walk");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    for expected_crawls in 1..=2 {
        let execution = WorkspaceFileRepository::new(&registry)
            .prepare_file_search(&cache, &id, Path::new(""), "", 80)
            .unwrap()
            .execute_with_visited_limit(1, &|| true)
            .unwrap();
        assert!(execution.truncated);
        assert_eq!(cache.crawl_count(), expected_crawls);
    }
    assert_eq!(cache.retained_index_count(), 0);
    assert_eq!(cache.last_rejection(), Some(IndexRejection::WalkTruncated));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn retained_indexes_are_evicted_deterministically_beyond_the_cache_capacity() {
    let (registry, id, root) = indexed_fixture("eviction");
    write_monorepo_tree(&root);
    let cache = WorkspaceFileIndexCache::with_bounds(indexing_bounds().with_cached_indexes(1));
    let root_file = registry.clone_root(&id).unwrap();
    let root_key = WorkspaceFileIndexKey::of(&id, &root_file, Path::new("")).unwrap();
    let scoped_key = WorkspaceFileIndexKey::of(&id, &root_file, Path::new("src")).unwrap();

    search(&registry, &cache, &id, Path::new(""), "", 80);
    assert!(cache.retained_file_count(&root_key).is_some());
    search(&registry, &cache, &id, Path::new("src"), "", 80);

    assert_eq!(cache.retained_index_count(), 1);
    assert!(cache.retained_file_count(&root_key).is_none());
    assert_eq!(cache.retained_file_count(&scoped_key), Some(5));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_queries_during_a_rebuild_stay_crawl_identical() {
    let (registry, id, root) = indexed_fixture("concurrent");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    let expected = PROPERTY_QUERIES
        .iter()
        .map(|query| crawled(&registry, &id, Path::new(""), query, 80))
        .collect::<Vec<_>>();

    let workers = (0..4)
        .map(|_| {
            let registry = Arc::clone(&registry);
            let cache = cache.clone();
            let id = id.clone();
            thread::spawn(move || {
                PROPERTY_QUERIES
                    .iter()
                    .map(|query| search(&registry, &cache, &id, Path::new(""), query, 80))
                    .collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();

    for worker in workers {
        assert_eq!(worker.join().unwrap(), expected);
    }
    assert_eq!(cache.retained_index_count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_superseded_index_served_query_fails_closed_without_results() {
    let (registry, id, root) = indexed_fixture("superseded");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);

    let error = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&cache, &id, Path::new(""), "app", 80)
        .unwrap()
        .execute(&|| false)
        .unwrap_err();

    assert_eq!(error.kind(), io::ErrorKind::Interrupted);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn the_search_walk_classifies_entries_without_stat_when_readdir_reports_the_kind() {
    let (registry, id, root) = indexed_fixture("d-type");
    write_monorepo_tree(&root);
    TEST_HOOK.with(|hook| {
        *hook.borrow_mut() = Some((
            "directory-entries-before-stat",
            Box::new(|_, _, _, _| panic!("search traversal must classify entries from d_type")),
        ));
    });

    let served = search(&registry, &cache_for_walk(), &id, Path::new(""), "", 80);

    TEST_HOOK.with(|hook| *hook.borrow_mut() = None);
    assert!(!served.is_empty());
    fs::remove_dir_all(root).unwrap();
}

fn cache_for_walk() -> WorkspaceFileIndexCache {
    WorkspaceFileIndexCache::new()
}

#[test]
fn a_file_content_change_alone_keeps_the_index_valid() {
    let (registry, id, root) = indexed_fixture("content-change");
    write_monorepo_tree(&root);
    let cache = indexing_cache();
    warm_index(&registry, &cache, &id);
    let hits_before = cache.index_hit_count();

    fs::write(root.join("src/app.ts"), "export const app = 1;\n").unwrap();
    let served = search(&registry, &cache, &id, Path::new(""), "app", 80);

    assert_eq!(cache.index_hit_count(), hits_before + 1);
    assert_eq!(cache.crawl_count(), 1);
    assert_eq!(served, crawled(&registry, &id, Path::new(""), "app", 80));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_directory_that_changed_while_it_was_enumerated_is_never_retained() {
    let root = target_root("unstable-directory");
    let directory = File::open(&root).unwrap();
    let before = fstat(directory.as_raw_fd()).unwrap();
    let mut after = before;
    after.st_mtime += 1;
    let mut builder = WorkspaceFileIndexBuilder::new(WorkspaceFileIndexBounds::default());

    builder
        .record_directory(&VisitedDirectory {
            relative: Path::new(""),
            before,
            after,
            gitignore: None,
        })
        .unwrap();

    assert_eq!(
        builder.finish(false, false).err(),
        Some(IndexRejection::UnstableDirectory)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_directory_stamped_inside_the_mtime_settle_window_is_never_retained() {
    for modified_nanoseconds in [0, 500_000_000] {
        let root = target_root("unsettled-directory");
        let directory = File::open(&root).unwrap();
        let mut stamp = fstat(directory.as_raw_fd()).unwrap();
        stamp.st_mtime = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        stamp.st_mtime_nsec = modified_nanoseconds;
        let mut builder = WorkspaceFileIndexBuilder::new(WorkspaceFileIndexBounds::default());

        builder
            .record_directory(&VisitedDirectory {
                relative: Path::new(""),
                before: stamp,
                after: stamp,
                gitignore: None,
            })
            .unwrap();

        assert_eq!(
            builder.finish(false, false).err(),
            Some(IndexRejection::UnstableDirectory),
            "a sub-second nanosecond field must not buy trust inside the settle window"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn the_default_policy_retains_an_index_once_directory_stamps_settle() {
    let (registry, id, root) = indexed_fixture("settled-default");
    write_monorepo_tree(&root);
    let cache = WorkspaceFileIndexCache::new();

    search(&registry, &cache, &id, Path::new(""), "", 80);
    let retained_before_settling = cache.retained_index_count();
    thread::sleep(std::time::Duration::from_millis(2_100));
    search(&registry, &cache, &id, Path::new(""), "", 80);

    assert_eq!(retained_before_settling, 0);
    assert_eq!(cache.retained_index_count(), 1);
    let hits_before = cache.index_hit_count();
    let served = search(&registry, &cache, &id, Path::new(""), "button", 80);
    assert_eq!(cache.index_hit_count(), hits_before + 1);
    assert_eq!(served, crawled(&registry, &id, Path::new(""), "button", 80));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_symlinked_scope_ancestor_stops_the_index_from_serving() {
    let (registry, id, root) = indexed_fixture("scope-ancestor");
    fs::create_dir_all(root.join("sub/dir")).unwrap();
    fs::write(root.join("sub/dir/target.ts"), "").unwrap();
    let cache = indexing_cache();
    let scope = Path::new("sub/dir");
    assert_eq!(search(&registry, &cache, &id, scope, "target", 80).len(), 1);
    assert_eq!(cache.retained_index_count(), 1);

    fs::rename(root.join("sub"), root.join("real")).unwrap();
    std::os::unix::fs::symlink("real", root.join("sub")).unwrap();
    let served = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&cache, &id, scope, "target", 80)
        .unwrap()
        .execute(&|| true);
    let crawled = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&WorkspaceFileIndexCache::new(), &id, scope, "target", 80)
        .unwrap()
        .execute(&|| true);

    assert!(
        crawled.is_err(),
        "the crawl must fail closed on a symlinked scope ancestor"
    );
    assert!(
        served.is_err(),
        "the index must not serve where the crawl fails closed"
    );
    assert_eq!(cache.retained_index_count(), 0);
    fs::remove_dir_all(root).unwrap();
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
    let execution = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(
            &WorkspaceFileIndexCache::new(),
            &id,
            Path::new(""),
            "match",
            1,
        )
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert_eq!(execution.results.len(), 1);
    assert!(execution.truncated);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn traversal_cap_with_no_matches_returns_truthful_metadata_without_a_sentinel() {
    let (registry, id, root) = fixture("no-match-traversal-cap");
    fs::write(root.join("first.ts"), "").unwrap();
    fs::write(root.join("second.ts"), "").unwrap();

    let execution = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(
            &WorkspaceFileIndexCache::new(),
            &id,
            Path::new(""),
            "does-not-match",
            20,
        )
        .unwrap()
        .execute_with_visited_limit(1, &|| true)
        .unwrap();

    assert!(execution.results.is_empty());
    assert!(execution.truncated);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn scoped_drive_prefixed_projection_is_skipped_truthfully() {
    let (registry, id, root) = fixture("scoped-drive-prefix");
    fs::create_dir_all(root.join("src/C:")).unwrap();
    fs::write(root.join("src/C:/file.ts"), "").unwrap();

    let execution = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(
            &WorkspaceFileIndexCache::new(),
            &id,
            Path::new("src"),
            "file",
            20,
        )
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert!(execution.results.is_empty());
    assert!(execution.truncated);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn ordinary_empty_search_is_not_truncated() {
    let (registry, id, root) = fixture("ordinary-empty");
    fs::write(root.join("ordinary.ts"), "").unwrap();

    let execution = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(
            &WorkspaceFileIndexCache::new(),
            &id,
            Path::new(""),
            "does-not-match",
            20,
        )
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert!(execution.results.is_empty());
    assert!(!execution.truncated);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn descriptor_projection_limits_match_the_gateway_contract() {
    let exact_name = format!(
        "{}.ts",
        "n".repeat(workspace_file_search::DESCRIPTOR_FILE_SEARCH_NAME_BYTE_LIMIT - 3)
    );
    assert!(workspace_file_search::is_descriptor_file_search_path(
        Path::new(&exact_name)
    ));
    assert!(!workspace_file_search::is_descriptor_file_search_path(
        Path::new(&format!(
            "{}.ts",
            "n".repeat(workspace_file_search::DESCRIPTOR_FILE_SEARCH_NAME_BYTE_LIMIT - 2)
        ))
    ));
    assert!(!workspace_file_search::is_descriptor_file_search_path(
        Path::new(&format!(
            "src/{}",
            "p".repeat(workspace_file_search::DESCRIPTOR_FILE_SEARCH_RELATIVE_PATH_BYTE_LIMIT)
        ))
    ));
    assert!(!workspace_file_search::is_descriptor_file_search_path(
        Path::new("src/control\u{0001}.ts")
    ));
    assert!(!workspace_file_search::is_descriptor_file_search_path(
        Path::new("src/back\\slash.ts")
    ));
    assert!(!workspace_file_search::is_descriptor_file_search_path(
        Path::new("C:/file.ts")
    ));
}

#[test]
fn unrepresentable_file_names_are_skipped_and_mark_the_envelope_truncated() {
    let (registry, id, root) = fixture("unrepresentable-name");
    fs::write(root.join("control\u{0001}.ts"), "").unwrap();
    fs::write(root.join("back\\slash.ts"), "").unwrap();
    fs::create_dir(root.join("C:")).unwrap();
    fs::write(root.join("C:/file.ts"), "").unwrap();

    let execution = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&WorkspaceFileIndexCache::new(), &id, Path::new(""), "", 20)
        .unwrap()
        .execute(&|| true)
        .unwrap();

    assert!(execution.results.is_empty());
    assert!(execution.truncated);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn projection_truncation_is_sticky_on_a_reused_representable_subset_index() {
    let (registry, id, root) = indexed_fixture("projection-truncation-cache");
    for index in 0..1_100 {
        fs::write(root.join(format!("filler-{index:04}.ts")), "").unwrap();
    }
    fs::write(root.join("unique-target-needle.ts"), "").unwrap();
    fs::write(root.join("control\u{0001}.ts"), "").unwrap();
    fs::write(root.join("back\\slash.ts"), "").unwrap();
    fs::create_dir(root.join("control\u{0001}-directory")).unwrap();
    fs::write(root.join("control\u{0001}-directory/first.ts"), "").unwrap();
    fs::create_dir(root.join("C:")).unwrap();
    fs::write(root.join("C:/file.ts"), "").unwrap();
    let cache = indexing_cache();

    for expected_hits in 0..=1 {
        let execution = WorkspaceFileRepository::new(&registry)
            .prepare_file_search(&cache, &id, Path::new(""), "unique-target-needle", 20)
            .unwrap()
            .execute(&|| true)
            .unwrap();
        assert_eq!(
            execution
                .results
                .iter()
                .map(|result| result.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["unique-target-needle.ts"]
        );
        assert!(execution.truncated);
        assert_eq!(cache.index_hit_count(), expected_hits);
    }

    assert_eq!(cache.crawl_count(), 1);
    assert_eq!(cache.retained_index_count(), 1);
    assert_eq!(cache.last_rejection(), None);

    fs::write(root.join("control\u{0001}-directory/second.ts"), "").unwrap();
    let rebuilt = WorkspaceFileRepository::new(&registry)
        .prepare_file_search(&cache, &id, Path::new(""), "unique-target-needle", 20)
        .unwrap()
        .execute(&|| true)
        .unwrap();
    assert_eq!(rebuilt.results.len(), 1);
    assert!(rebuilt.truncated);
    assert_eq!(cache.crawl_count(), 2);
    assert_eq!(cache.index_hit_count(), 1);
    assert_eq!(cache.retained_index_count(), 1);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn text_search_visitor_marks_unrepresentable_directory_entries_truncated() {
    let mut projection_truncated = false;
    let mut visit = |_relative: PathBuf| Ok(true);
    let mut visitor = workspace_file_search::FileVisitor {
        visit: &mut visit,
        projection_truncated: &mut projection_truncated,
    };

    workspace_file_search::WorkspaceWalkSink::projection_omitted(&mut visitor);

    assert!(projection_truncated);
}
