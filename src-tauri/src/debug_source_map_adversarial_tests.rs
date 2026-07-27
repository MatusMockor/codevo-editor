use super::registry::SourceMapRegistry;
use crate::debug_support::file_url_from_path;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const MAP_TO_FIRST_LINE: &str =
    r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAAA"}"#;
const MAP_TO_THIRD_LINE: &str =
    r#"{"version":3,"file":"app.js","sources":["../src/app.ts"],"names":[],"mappings":"AAEA"}"#;

#[test]
fn newer_pending_generation_hides_the_committed_same_script_mapping() {
    let root = fixture("pending-revokes-committed");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map_a = root.join("dist/a.map");
    let map_b = root.join("dist/b.map");
    write(&generated, "compiled();\n");
    write(&source, "first();\nsecond();\nthird();\n");
    write(&map_a, MAP_TO_FIRST_LINE);
    write(&map_b, MAP_TO_THIRD_LINE);
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let loader = registry.loader();
    registry
        .commit_script(
            loader
                .prepare_script(
                    "script",
                    &generated_url,
                    &file_url_from_path(&map_a.to_string_lossy()),
                )
                .expect("initial map"),
        )
        .expect("initial commit");
    assert_eq!(
        registry
            .map_generated_for_script("script", &generated_url, 0, 0)
            .expect("initial mapping")
            .line_number,
        1
    );
    let forward = registry
        .map_generated_candidate_for_script("script", &generated_url, 0, 0)
        .expect("forward candidate")
        .validate_with_receipt()
        .expect("validated forward candidate");
    let reverse = registry
        .map_original_line_candidate(&source, 1)
        .expect("reverse candidate")
        .validate_with_receipt()
        .expect("validated reverse candidate");

    let replacement = loader
        .reserve_script(
            "script",
            &generated_url,
            &file_url_from_path(&map_b.to_string_lossy()),
        )
        .expect("replacement reservation");
    registry
        .mark_pending(replacement.settlement())
        .expect("replacement pending");
    assert!(!registry.is_current_receipt(&forward.receipt));
    assert!(!registry.is_current_receipt(&reverse.receipt));

    assert!(
        registry
            .map_generated_candidate_for_script("script", &generated_url, 0, 0)
            .is_none(),
        "a newer pending generation must hide the committed generation"
    );
    assert!(
        registry.map_original_line(&source, 1).is_none(),
        "reverse lookup must not expose the committed generation while its script is pending"
    );

    registry
        .commit_script(replacement.prepare().expect("replacement map"))
        .expect("replacement commit");
    assert_eq!(
        registry
            .map_generated_for_script("script", &generated_url, 0, 0)
            .expect("replacement mapping")
            .line_number,
        3
    );
}

#[cfg(unix)]
#[test]
fn reverse_lookup_rejects_replaced_source_leaf_and_workspace_root() {
    let root = fixture("reverse-authority");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.map");
    write(&generated, "compiled();\n");
    write(&source, "original();\n");
    write(&map, MAP_TO_FIRST_LINE);
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    registry
        .register_script(&generated_url, &file_url_from_path(&map.to_string_lossy()))
        .expect("registered map");

    fs::remove_file(&source).expect("remove original source");
    write(&source, "replacement();\n");
    assert!(
        registry.map_original_line(&source, 1).is_none(),
        "a replacement source leaf must not inherit the retained source map"
    );

    let moved = root.with_extension("retained");
    fs::rename(&root, &moved).expect("move retained workspace");
    let replacement_source = root.join("src/app.ts");
    write(&replacement_source, "foreign workspace();\n");
    assert!(
        registry.map_original_line(&replacement_source, 1).is_none(),
        "a replacement workspace root must not inherit the retained source map"
    );
}

#[cfg(unix)]
#[test]
fn external_map_reservation_never_binds_a_replacement_leaf() {
    let root = fixture("external-map-replacement");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.map");
    let replacement = root.join("dist/replacement.map");
    write(&generated, "compiled();\n");
    write(&source, "first();\nsecond();\nthird();\n");
    write(&map, MAP_TO_FIRST_LINE);
    write(&replacement, MAP_TO_THIRD_LINE);
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let request = registry
        .loader()
        .reserve_script(
            "script",
            &generated_url,
            &file_url_from_path(&map.to_string_lossy()),
        )
        .expect("reservation");

    fs::rename(&replacement, &map).expect("replace source-map leaf");
    match request.prepare() {
        Ok(prepared) => {
            registry
                .commit_script(prepared)
                .expect("retained exact map may commit");
            assert_eq!(
                registry
                    .map_generated_for_script("script", &generated_url, 0, 0)
                    .expect("exact retained mapping")
                    .line_number,
                1,
                "the replacement map must never bind to the older script generation"
            );
        }
        Err(error) => assert!(
            error.contains("changed") || error.contains("authority"),
            "fail-closed replacement diagnostic must be truthful: {error}"
        ),
    }
}

#[cfg(unix)]
#[test]
fn external_map_reservation_survives_a_b_a_only_with_the_exact_a_identity() {
    let root = fixture("external-map-aba");
    let generated = root.join("dist/app.js");
    let source = root.join("src/app.ts");
    let map = root.join("dist/app.map");
    let retained_a = root.join("dist/retained-a.map");
    let replacement_b = root.join("dist/replacement-b.map");
    write(&generated, "compiled();\n");
    write(&source, "first();\nsecond();\nthird();\n");
    write(&map, MAP_TO_FIRST_LINE);
    write(&replacement_b, MAP_TO_THIRD_LINE);
    let generated_url = file_url_from_path(&generated.to_string_lossy());
    let mut registry = SourceMapRegistry::new(&root).expect("registry");
    let request = registry
        .loader()
        .reserve_script(
            "script",
            &generated_url,
            &file_url_from_path(&map.to_string_lossy()),
        )
        .expect("reservation");

    fs::rename(&map, &retained_a).expect("retain A elsewhere");
    fs::rename(&replacement_b, &map).expect("install B");
    fs::remove_file(&map).expect("remove B");
    fs::rename(&retained_a, &map).expect("restore exact A");

    let prepared = request
        .prepare()
        .expect("an exact retained A descriptor may survive A-B-A");
    registry.commit_script(prepared).expect("commit exact A");
    assert_eq!(
        registry
            .map_generated_for_script("script", &generated_url, 0, 0)
            .expect("exact A mapping")
            .line_number,
        1
    );
}

#[test]
fn retained_source_authority_budget_is_global_and_released_on_eviction() {
    // Minimal test-only API requested from the production owner:
    // `new_with_source_authority_limit_for_test(root, limit)` installs a small
    // session-wide descriptor budget without changing production limits, and
    // `retained_source_authority_count_for_test()` exposes accounting only.
    let root = fixture("source-authority-budget");
    let generated_a = root.join("dist/a.js");
    let generated_b = root.join("dist/b.js");
    let source_a = root.join("src/a.ts");
    let source_b = root.join("src/b.ts");
    let map_a = root.join("dist/a.map");
    let map_b = root.join("dist/b.map");
    for generated in [&generated_a, &generated_b] {
        write(generated, "compiled();\n");
    }
    write(&source_a, "a();\n");
    write(&source_b, "b();\n");
    write(
        &map_a,
        r#"{"version":3,"file":"a.js","sources":["../src/a.ts"],"names":[],"mappings":"AAAA"}"#,
    );
    write(
        &map_b,
        r#"{"version":3,"file":"b.js","sources":["../src/b.ts"],"names":[],"mappings":"AAAA"}"#,
    );
    let url_a = file_url_from_path(&generated_a.to_string_lossy());
    let url_b = file_url_from_path(&generated_b.to_string_lossy());
    let mut registry =
        SourceMapRegistry::new_with_source_authority_limit_for_test(&root, 1).expect("registry");
    let loader = registry.loader();
    registry
        .commit_script(
            loader
                .prepare_script(
                    "script-a",
                    &url_a,
                    &file_url_from_path(&map_a.to_string_lossy()),
                )
                .expect("prepare A"),
        )
        .expect("admit A");
    assert_eq!(registry.retained_source_authority_count_for_test(), 1);

    let overflow = loader
        .prepare_script(
            "script-b",
            &url_b,
            &file_url_from_path(&map_b.to_string_lossy()),
        )
        .expect("prepare B");
    assert!(
        registry
            .commit_script(overflow)
            .expect_err("global source authority cap")
            .contains("source-authority"),
        "the failure must name the exhausted bounded resource"
    );
    assert_eq!(registry.retained_source_authority_count_for_test(), 1);

    registry.evict_script(&url_a);
    assert_eq!(registry.retained_source_authority_count_for_test(), 0);
    registry
        .commit_script(
            loader
                .prepare_script(
                    "script-b",
                    &url_b,
                    &file_url_from_path(&map_b.to_string_lossy()),
                )
                .expect("reprepare B"),
        )
        .expect("released authority slot");
    assert_eq!(registry.retained_source_authority_count_for_test(), 1);
}

fn fixture(name: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let root = std::env::temp_dir().join(format!(
        "codevo-source-map-adversarial-{name}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&root).expect("fixture root");
    root.canonicalize().expect("canonical fixture")
}

fn write(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("fixture parent");
    }
    fs::write(path, content).expect("fixture write");
}
