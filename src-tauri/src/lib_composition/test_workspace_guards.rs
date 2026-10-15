#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn register_workspace_path_preserves_alias_and_returns_canonical_identity() {
    use std::os::unix::fs::symlink;

    let registry = WorkspaceRegistry::new();
    let root = temp_workspace("register-alias");
    let alias = root.with_extension(format!("alias-{}", unique_suffix()));
    symlink(&root, &alias).expect("workspace alias");

    let descriptor =
        register_workspace_path_in_registry(&registry, alias.to_str().expect("UTF-8 alias path"))
            .expect("register aliased workspace")
            .descriptor;

    assert_eq!(descriptor.selected_root_path, alias);
    assert_eq!(descriptor.canonical_root_path, root);
    assert_eq!(
        registry
            .descriptor(&descriptor.workspace_id)
            .expect("registered descriptor"),
        descriptor
    );
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn register_workspace_path_preserves_lexical_parent_and_returns_canonical_identity() {
    let registry = WorkspaceRegistry::new();
    let root = temp_workspace("register-lexical-parent");
    let child = root.join("child");
    fs::create_dir(&child).expect("workspace child");
    let selected = child.join("..");

    let descriptor = register_workspace_path_in_registry(
        &registry,
        selected.to_str().expect("UTF-8 selected path"),
    )
    .expect("register lexical workspace path")
    .descriptor;

    assert_eq!(descriptor.selected_root_path, selected);
    assert_eq!(descriptor.canonical_root_path, root);
}

#[test]
fn register_workspace_path_rejects_relative_roots() {
    let registry = WorkspaceRegistry::new();

    let error = register_workspace_path_in_registry(&registry, "relative/workspace")
        .expect_err("relative workspace root must be rejected");

    assert_eq!(error, "Workspace root path must be absolute");
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
#[test]
fn picker_registration_rejects_non_utf8_before_registry_mutation() {
    use std::ffi::OsString;
    use std::os::unix::ffi::OsStringExt;

    let registry = WorkspaceRegistry::new();
    let invalid = PathBuf::from(OsString::from_vec(vec![b'/', 0xff]));

    let error = register_picker_path_in_registry(&registry, invalid)
        .expect_err("non-UTF-8 picker root must be rejected");
    assert_eq!(error, "Selected workspace path is not valid UTF-8.");

    let root = temp_workspace("picker-after-non-utf8");
    let registration =
        register_workspace_path_in_registry(&registry, root.to_str().expect("UTF-8 root"))
            .expect("valid registration after rejection");
    assert!(registration.receipt.created_identity);
    assert_eq!(registration.receipt.admission_token, 1);
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

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}
