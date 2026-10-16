use super::*;

fn request(value: serde_json::Value) -> Result<WorkspaceFilePreviewRequest, serde_json::Error> {
    serde_json::from_value(value)
}

#[test]
fn request_accepts_exactly_the_two_camel_case_fields() {
    let parsed = request(serde_json::json!({
        "workspaceRoot": "/work/app",
        "relativePath": "src/main.ts"
    }))
    .unwrap();
    let validated = validate_request(parsed).unwrap();

    assert_eq!(validated.workspace_root, PathBuf::from("/work/app"));
    assert_eq!(validated.relative_path, "src/main.ts");
}

#[test]
fn request_rejects_unknown_missing_and_mistyped_fields() {
    for rejected in [
        serde_json::json!({ "workspaceRoot": "/w", "relativePath": "a", "maxBytes": 1 }),
        serde_json::json!({ "workspaceRoot": "/w" }),
        serde_json::json!({ "workspace_root": "/w", "relativePath": "a" }),
        serde_json::json!({ "workspaceRoot": 1, "relativePath": "a" }),
    ] {
        assert!(request(rejected).is_err());
    }
}

#[test]
fn validation_rejects_relative_roots_and_unsafe_relative_paths() {
    let cases = [
        ("relative/root", "a.txt"),
        ("/root\0x", "a.txt"),
        ("/root", ""),
        ("/root", "../a.txt"),
        ("/root", "/etc/hosts"),
    ];
    for (workspace_root, relative_path) in cases {
        let result = validate_request(WorkspaceFilePreviewRequest {
            workspace_root: workspace_root.to_owned(),
            relative_path: relative_path.to_owned(),
        });
        assert!(result.is_err(), "{workspace_root} {relative_path}");
    }
}

#[test]
fn validation_bounds_path_lengths() {
    let long_root = format!("/{}", "r".repeat(MAX_WORKSPACE_ROOT_BYTES));
    let long_relative = "a".repeat(MAX_RELATIVE_PATH_BYTES + 1);

    assert!(validate_request(WorkspaceFilePreviewRequest {
        workspace_root: long_root,
        relative_path: "a.txt".to_owned(),
    })
    .is_err());
    assert!(validate_request(WorkspaceFilePreviewRequest {
        workspace_root: "/root".to_owned(),
        relative_path: long_relative,
    })
    .is_err());
}

#[test]
fn concurrent_reads_are_bounded_and_permits_are_released_on_drop() {
    let permits = (0..MAX_CONCURRENT_PREVIEW_READS)
        .map(|_| PreviewReadPermit::acquire())
        .collect::<Vec<_>>();
    let saturated = permits.iter().all(Result::is_ok);
    let overflow = PreviewReadPermit::acquire();
    drop(permits);

    assert!(saturated);
    assert!(overflow.is_err());
    assert!(PreviewReadPermit::acquire().is_ok());
}

#[test]
fn the_command_is_registered_under_its_wire_name() {
    assert!(include_str!("runtime.rs")
        .contains("workspace_file_preview_commands::workspace_read_file_preview,"));
}

#[test]
fn read_errors_classify_io_kinds_and_serialize_without_os_messages() {
    for (io_kind, wire_kind) in [
        (std::io::ErrorKind::NotFound, "notFound"),
        (std::io::ErrorKind::PermissionDenied, "unreadable"),
        (std::io::ErrorKind::InvalidInput, "notRegularFile"),
        (std::io::ErrorKind::IsADirectory, "notRegularFile"),
        (std::io::ErrorKind::Other, "operationFailed"),
    ] {
        let error = FilePreviewReadError::from_io(std::io::Error::new(io_kind, "os error 2"));
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({ "kind": wire_kind })
        );
    }
}

#[test]
fn a_symlink_rejected_by_the_no_follow_open_is_not_a_regular_file() {
    let directory = std::env::temp_dir().join(format!(
        "codevo-preview-symlink-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("target.txt"), "x").unwrap();
    std::os::unix::fs::symlink("target.txt", directory.join("link.txt")).unwrap();

    let root = std::fs::File::open(&directory).unwrap();
    let error = read_file_preview_from_root(&root, "link.txt").unwrap_err();
    std::fs::remove_dir_all(&directory).unwrap();

    assert_eq!(
        FilePreviewReadError::from_io(error),
        FilePreviewReadError::NotRegularFile
    );
}
