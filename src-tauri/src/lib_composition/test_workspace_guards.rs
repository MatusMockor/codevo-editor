#[test]
fn local_history_relative_path_guard_rejects_escape_and_absolute_paths() {
    assert!(ensure_local_history_relative_path("src/User.php").is_ok());
    assert!(ensure_local_history_relative_path("src\\User.php").is_ok());
    assert!(ensure_local_history_relative_path("").is_err());
    assert!(ensure_local_history_relative_path(".").is_err());
    assert!(ensure_local_history_relative_path("src/./User.php").is_err());
    assert!(ensure_local_history_relative_path("src//User.php").is_err());
    assert!(ensure_local_history_relative_path("src/User.php/").is_err());
    assert!(ensure_local_history_relative_path("../secret.txt").is_err());
    assert!(ensure_local_history_relative_path("nested/../../secret.txt").is_err());
    assert!(ensure_local_history_relative_path("/etc/passwd").is_err());
    assert!(ensure_local_history_relative_path("C:/secret.txt").is_err());
    assert!(ensure_local_history_relative_path("C:\\secret.txt").is_err());
    // Backslash-expressed traversal must also be rejected (Windows paths).
    assert!(ensure_local_history_relative_path("..\\secret.txt").is_err());
    assert!(ensure_local_history_relative_path("nested\\..\\..\\secret.txt").is_err());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn local_history_authorizer_accepts_registered_aliases_and_canonical_root() {
    use std::os::unix::fs::symlink;

    let root = temp_workspace("local-history-authorized-root");
    let alias_parent = temp_workspace("local-history-authorized-alias-parent");
    let alias = alias_parent.join("workspace-alias");
    symlink(&root, &alias).expect("workspace alias");
    let registry = WorkspaceRegistry::new();
    let authorizer = LegacyLocalHistoryWorkspaceAuthorizer::default();
    let descriptor = registry.register(&alias).expect("register alias");
    authorizer.admit(&descriptor);

    let alias_identity = authorizer
        .authorize(&registry, &path_string(&alias))
        .expect("authorize alias");
    let canonical_identity = authorizer
        .authorize(&registry, &path_string(&root))
        .expect("authorize canonical root");
    assert_eq!(alias_identity, path_string(&root));
    assert_eq!(canonical_identity, path_string(&root));

    let store = LocalHistoryStore::new(temp_workspace("local-history-canonical-compat"));
    store
        .record_snapshot(&path_string(&root), "src/User.php", "legacy-canonical")
        .expect("legacy canonical history");
    assert_eq!(
        store
            .list_versions(&alias_identity, "src/User.php")
            .expect("history through authorized alias")
            .len(),
        1,
        "authorized aliases retain compatibility with canonical legacy buckets"
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn local_history_authorizer_rejects_unknown_and_closed_roots() {
    let registered_root = temp_workspace("local-history-registered-root");
    let unknown_root = temp_workspace("local-history-unknown-root");
    let registry = WorkspaceRegistry::new();
    let authorizer = LegacyLocalHistoryWorkspaceAuthorizer::default();
    let descriptor = registry
        .register(&registered_root)
        .expect("register workspace");
    authorizer.admit(&descriptor);

    assert!(authorizer
        .authorize(&registry, &path_string(&unknown_root))
        .is_err());

    registry
        .unregister(&descriptor.workspace_id)
        .expect("close workspace");
    assert!(authorizer
        .authorize(&registry, &path_string(&registered_root))
        .is_err());
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn local_history_alias_retarget_cannot_reuse_the_previous_owners_bucket() {
    use std::os::unix::fs::symlink;

    let root_a = temp_workspace("local-history-retarget-a");
    let root_b = temp_workspace("local-history-retarget-b");
    let alias_parent = temp_workspace("local-history-retarget-alias-parent");
    let alias = alias_parent.join("workspace-alias");
    let alias_key = path_string(&alias);
    let registry = WorkspaceRegistry::new();
    let authorizer = LegacyLocalHistoryWorkspaceAuthorizer::default();
    let store = LocalHistoryStore::new(temp_workspace("local-history-retarget-store"));

    symlink(&root_a, &alias).expect("alias workspace A");
    let descriptor_a = registry.register(&alias).expect("register workspace A");
    authorizer.admit(&descriptor_a);
    let storage_a = authorizer
        .authorize(&registry, &alias_key)
        .expect("authorize workspace A");
    store
        .record_snapshot(&storage_a, "src/User.php", "canonical-a")
        .expect("canonical A history");
    store
        .record_snapshot(&alias_key, "src/User.php", "legacy-alias-a")
        .expect("simulate pre-fix alias history");

    registry
        .unregister(&descriptor_a.workspace_id)
        .expect("close workspace A");
    authorizer.revoke(&descriptor_a.workspace_id);
    fs::remove_file(&alias).expect("remove workspace A alias");
    symlink(&root_b, &alias).expect("retarget alias to workspace B");

    let descriptor_b = registry.register(&alias).expect("register workspace B");
    authorizer.admit(&descriptor_b);
    let storage_b = authorizer
        .authorize(&registry, &alias_key)
        .expect("authorize workspace B");

    assert_eq!(storage_a, path_string(&root_a));
    assert_eq!(storage_b, path_string(&root_b));
    assert!(store
        .list_versions(&storage_b, "src/User.php")
        .expect("workspace B history")
        .is_empty());
    assert_eq!(
        store
            .list_versions(&alias_key, "src/User.php")
            .expect("quarantined legacy alias history")
            .len(),
        1,
        "unowned legacy alias history remains quarantined instead of being adopted"
    );
}

#[test]
fn get_git_file_commit_diff_reports_commit_blobs_off_thread() {
    let root = temp_workspace("git-file-commit-diff-off-thread");
    init_test_git_repo(&root);
    fs::write(root.join("file.txt"), "one\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "first"]);
    fs::write(root.join("file.txt"), "one\ntwo\n").expect("write file");
    run_test_git(&root, &["add", "file.txt"]);
    run_test_git(&root, &["commit", "-m", "second"]);

    let sha = String::from_utf8_lossy(
        &std::process::Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&root)
            .output()
            .expect("rev-parse")
            .stdout,
    )
    .trim()
    .to_string();

    let diff = tauri::async_runtime::block_on(get_git_file_commit_diff(
        path_string(&root),
        "file.txt".to_string(),
        sha,
        true,
    ))
    .expect("file commit diff result");

    assert_eq!(diff.original_content, "one\n");
    assert_eq!(diff.modified_content, "one\ntwo\n");
    assert_eq!(diff.change.relative_path, "file.txt");
}

#[test]
fn get_git_file_commit_diff_rejects_invalid_sha_off_thread() {
    let root = temp_workspace("git-file-commit-diff-bad-sha");
    init_test_git_repo(&root);

    assert!(tauri::async_runtime::block_on(get_git_file_commit_diff(
        path_string(&root),
        "file.txt".to_string(),
        "HEAD".to_string(),
        true
    ))
    .is_err());
}

#[cfg(unix)]
#[test]
fn index_path_guard_accepts_paths_through_symlinked_root() {
    use std::os::unix::fs::symlink;

    let root = temp_workspace("symlink-root");
    let source_directory = root.join("src");
    let linked_root = root
        .parent()
        .expect("workspace parent")
        .join(format!("{}-link", unique_suffix()));
    fs::create_dir_all(&source_directory).expect("source directory");
    fs::write(source_directory.join("User.php"), "<?php").expect("source file");
    symlink(&root, &linked_root).expect("workspace symlink");

    assert!(
        ensure_path_in_workspace(&root, &path_string(&linked_root.join("src/User.php"))).is_ok()
    );
}

#[cfg(unix)]
#[test]
fn index_path_guard_rejects_symlink_escape_paths() {
    use std::os::unix::fs::symlink;

    let root = temp_workspace("symlink-escape-root");
    let outside = temp_workspace("symlink-escape-outside");
    let linked_outside = root.join("linked-outside");
    fs::write(outside.join("Secret.php"), "<?php").expect("outside file");
    symlink(&outside, &linked_outside).expect("outside symlink");

    assert!(
        ensure_path_in_workspace(&root, &path_string(&linked_outside.join("Secret.php"))).is_err()
    );
    assert!(ensure_path_in_workspace(&root, "linked-outside/Missing.php").is_err());
}

#[cfg(unix)]
#[test]
fn reveal_path_guard_rejects_paths_outside_workspace_and_symlink_escapes() {
    use std::os::unix::fs::symlink;

    let root = temp_workspace("reveal-root");
    let outside = temp_workspace("reveal-outside");
    let inside_file = root.join("Inside.php");
    let outside_file = outside.join("Secret.php");
    fs::write(&inside_file, "<?php").expect("inside file");
    fs::write(&outside_file, "<?php").expect("outside file");
    symlink(&outside, root.join("linked-outside")).expect("outside symlink");

    assert_eq!(
        reveal_path_in_workspace(&path_string(&root), &path_string(&inside_file))
            .expect("in-root reveal path"),
        inside_file
            .canonicalize()
            .expect("canonical in-root reveal path")
    );
    assert!(reveal_path_in_workspace(&path_string(&root), &path_string(&outside_file)).is_err());
    assert!(reveal_path_in_workspace(
        &path_string(&root),
        &path_string(&root.join("linked-outside/Secret.php")),
    )
    .is_err());
}

#[test]
fn normalize_path_removes_parent_and_current_components() {
    assert_eq!(
        normalize_path(Path::new("/workspace/project/../project/./src")),
        Path::new("/workspace/project/src")
    );
}

#[test]
fn disposal_workspace_root_falls_back_to_normalized_missing_paths() {
    let root = temp_workspace("disposal-fallback-root");
    let missing = root.join("missing").join("..").join("missing-again");

    assert_eq!(
        workspace_root_for_disposal(&path_string(&missing)),
        root.join("missing-again")
    );
}

#[test]
fn disposal_workspace_root_uses_canonical_existing_paths() {
    let root = temp_workspace("disposal-canonical-root");
    let nested = root.join("src");
    fs::create_dir_all(&nested).expect("nested directory");

    assert_eq!(
        workspace_root_for_disposal(&path_string(&root.join(".").join("src"))),
        nested.canonicalize().expect("canonical nested")
    );
}

#[test]
fn monospace_font_cache_scans_once_and_reuses_result() {
    let cache: OnceLock<Vec<String>> = OnceLock::new();
    let scans = AtomicUsize::new(0);
    let scan = || {
        scans.fetch_add(1, Ordering::SeqCst);
        vec!["Fira Code".to_string(), "Menlo".to_string()]
    };

    let first = cached_monospace_font_families(&cache, scan).clone();
    let second = cached_monospace_font_families(&cache, scan).clone();
    let third = cached_monospace_font_families(&cache, scan).clone();

    assert_eq!(first, vec!["Fira Code".to_string(), "Menlo".to_string()]);
    assert_eq!(first, second);
    assert_eq!(second, third);
    assert_eq!(
        scans.load(Ordering::SeqCst),
        1,
        "system font scan must run at most once per session cache",
    );
}

#[test]
fn monospace_font_enumeration_returns_sorted_unique_families() {
    let families = enumerate_monospace_font_families();

    let mut sorted = families.clone();
    sorted.sort();
    assert_eq!(families, sorted, "families must be sorted");

    let mut deduped = families.clone();
    deduped.dedup();
    assert_eq!(families, deduped, "families must be unique");

    assert!(
        families.iter().all(|family| !family.trim().is_empty()),
        "families must not contain blank names",
    );
}

fn temp_workspace(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("editor-lib-{label}-{}", unique_suffix()));
    fs::create_dir_all(&root).expect("temp workspace");
    root.canonicalize().expect("canonical workspace")
}

fn sibling_prefix_workspace(root: &Path, suffix: &str) -> PathBuf {
    let name = root.file_name().expect("workspace name").to_string_lossy();
    let sibling = root.with_file_name(format!("{name}-{suffix}"));
    fs::create_dir_all(&sibling).expect("sibling prefix workspace");
    sibling.canonicalize().expect("canonical sibling workspace")
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn php_document_content(path: &str) -> TextDocumentContent {
    TextDocumentContent {
        path: path.to_string(),
        language_id: "php".to_string(),
        version: 1,
        text: "<?php".to_string(),
    }
}

fn completion_item(data: Value) -> LanguageServerCompletionItem {
    serde_json::from_value(json!({
        "label": "App",
        "data": data,
    }))
    .expect("completion item")
}

fn code_action(payload: Value) -> LanguageServerCodeAction {
    let mut value = json!({
        "title": "Resolve action",
    });
    merge_object(&mut value, payload);

    serde_json::from_value(value).expect("code action")
}

fn code_action_context(data: Value) -> LanguageServerCodeActionContext {
    serde_json::from_value(json!({
        "diagnostics": [
            {
                "range": lsp_range(),
                "message": "Cannot find name",
                "data": data,
            }
        ]
    }))
    .expect("code action context")
}

fn code_lens(payload: Value) -> LanguageServerCodeLens {
    let mut value = json!({
        "range": lsp_range(),
    });
    merge_object(&mut value, payload);

    serde_json::from_value(value).expect("code lens")
}

fn document_link(payload: Value) -> LanguageServerDocumentLink {
    let mut value = json!({
        "range": lsp_range(),
    });
    merge_object(&mut value, payload);

    serde_json::from_value(value).expect("document link")
}

fn inlay_hint(payload: Value) -> LanguageServerInlayHint {
    let mut value = json!({
        "label": "hint",
        "paddingLeft": false,
        "paddingRight": false,
        "position": {
            "line": 0,
            "character": 4,
        },
    });
    merge_object(&mut value, payload);

    serde_json::from_value(value).expect("inlay hint")
}

fn location(uri: &str) -> LanguageServerLocation {
    LanguageServerLocation {
        uri: uri.to_string(),
        range: lsp_range(),
    }
}

fn workspace_symbol(name: &str, uri: &str) -> LanguageServerWorkspaceSymbol {
    LanguageServerWorkspaceSymbol {
        container_name: None,
        kind: 12,
        location: Some(location(uri)),
        name: name.to_string(),
    }
}

fn incoming_call(uri: &str) -> LanguageServerIncomingCall {
    LanguageServerIncomingCall {
        from: call_hierarchy_item(uri),
        from_ranges: vec![lsp_range()],
    }
}

fn outgoing_call(uri: &str) -> LanguageServerOutgoingCall {
    LanguageServerOutgoingCall {
        to: call_hierarchy_item(uri),
        from_ranges: vec![lsp_range()],
    }
}

fn call_hierarchy_item(uri: &str) -> LanguageServerCallHierarchyItem {
    serde_json::from_value(json!({
        "name": "render",
        "kind": 12,
        "uri": uri,
        "range": lsp_range(),
        "selectionRange": lsp_range(),
    }))
    .expect("call hierarchy item")
}

fn type_hierarchy_item(uri: &str) -> LanguageServerTypeHierarchyItem {
    serde_json::from_value(json!({
        "name": "View",
        "kind": 5,
        "uri": uri,
        "range": lsp_range(),
        "selectionRange": lsp_range(),
    }))
    .expect("type hierarchy item")
}

fn lsp_range() -> LanguageServerRange {
    LanguageServerRange {
        start: LanguageServerPosition {
            line: 0,
            character: 0,
        },
        end: LanguageServerPosition {
            line: 0,
            character: 3,
        },
    }
}

fn text_edit(new_text: &str) -> LanguageServerTextEdit {
    LanguageServerTextEdit {
        range: lsp_range(),
        new_text: new_text.to_string(),
    }
}

fn json_text_edit(new_text: &str) -> Value {
    json!({
        "range": lsp_range(),
        "newText": new_text,
    })
}

fn command_with_argument(argument: String) -> LanguageServerCodeActionCommand {
    serde_json::from_value(json!({
        "title": "Apply edit",
        "command": "_typescript.applyEdit",
        "arguments": [argument],
    }))
    .expect("code action command")
}

fn merge_object(value: &mut Value, payload: Value) {
    let value = value.as_object_mut().expect("object value");
    let payload = payload.as_object().expect("object payload");

    for (key, field) in payload {
        value.insert(key.clone(), field.clone());
    }
}

// The index/file/parse commands moved off the Tauri main thread (async fn +
// spawn_blocking). These tests drive the real async commands through the Tauri
// async runtime and assert behaviour is unchanged off-thread, that concurrent
// requests succeed, and that file commands stay isolated per workspace root.
