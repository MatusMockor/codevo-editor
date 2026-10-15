#[test]
fn read_directory_stays_isolated_per_workspace_root_off_thread() {
    let root_a = temp_workspace("dir-iso-a");
    let root_b = temp_workspace("dir-iso-b");
    fs::write(root_a.join("only-in-a.php"), "<?php").expect("file in a");
    fs::write(root_b.join("only-in-b.php"), "<?php").expect("file in b");

    let entries_a = tauri::async_runtime::block_on(read_directory(path_string(&root_a)))
        .expect("read directory a");
    let entries_b = tauri::async_runtime::block_on(read_directory(path_string(&root_b)))
        .expect("read directory b");

    let names_a: Vec<&str> = entries_a.iter().map(|entry| entry.name.as_str()).collect();
    let names_b: Vec<&str> = entries_b.iter().map(|entry| entry.name.as_str()).collect();

    assert!(names_a.contains(&"only-in-a.php"));
    assert!(!names_a.contains(&"only-in-b.php"));
    assert!(names_b.contains(&"only-in-b.php"));
    assert!(!names_b.contains(&"only-in-a.php"));
    assert!(entries_a
        .iter()
        .all(|entry| matches!(entry.kind, FileEntryKind::File)));
}

#[test]
fn search_files_finds_workspace_files_off_thread() {
    let root = temp_workspace("search-files");
    fs::write(root.join("Controller.php"), "<?php").expect("controller");
    fs::write(root.join("README.md"), "docs").expect("readme");

    let results = tauri::async_runtime::block_on(search_files(
        path_string(&root),
        "Controller".to_string(),
        10,
    ))
    .expect("search result");

    assert!(
        results
            .iter()
            .any(|result| result.path.ends_with("Controller.php")),
        "expected Controller.php in results, got {results:?}"
    );
}
