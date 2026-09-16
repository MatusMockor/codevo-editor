use super::*;
use std::os::unix::fs::symlink;
fn owner<'a>(turn: &'a str) -> ArtifactOwner<'a> {
    ArtifactOwner {
        root_key: "/workspace",
        thread_id: "thread-one",
        turn_id: turn,
    }
}
#[test]
fn immutable_snapshot_survives_source_removal_and_restart_and_rejects_foreign_owner() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let workspace = base.join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("design.html"), "<h1>First</h1>").unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    let first = store
        .resolve(&owner("turn-one"), &workspace, "design.html")
        .unwrap();
    fs::write(workspace.join("design.html"), "<h1>Second</h1>").unwrap();
    assert_eq!(
        store
            .resolve(&owner("turn-one"), &workspace, "design.html")
            .unwrap(),
        first
    );
    fs::remove_file(workspace.join("design.html")).unwrap();
    let reopened = OutputArtifactStore::new(base.join("storage"));
    assert_eq!(
        reopened.read(&owner("turn-one"), &first.id).unwrap(),
        b"<h1>First</h1>"
    );
    assert!(reopened.read(&owner("turn-two"), &first.id).is_err());
    assert!(reopened.read(&owner("turn-one"), "../secret").is_err());
}
#[test]
fn traversal_symlink_hard_link_and_type_mismatch_fail_closed() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let workspace = base.join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(base.join("secret.html"), "private").unwrap();
    symlink(base.join("secret.html"), workspace.join("link.html")).unwrap();
    symlink(&base, workspace.join("dir")).unwrap();
    fs::hard_link(base.join("secret.html"), workspace.join("hard.html")).unwrap();
    fs::write(workspace.join("fake.png"), "not a png").unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    for reference in [
        "../secret.html",
        "link.html",
        "dir/secret.html",
        "hard.html",
        "fake.png",
        "/etc/passwd",
        "design.svg",
    ] {
        assert!(
            store
                .resolve(&owner("turn"), &workspace, reference)
                .is_err(),
            "{reference}"
        );
    }
}
#[test]
fn empty_invalid_utf8_and_oversized_html_are_rejected() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    for bytes in [vec![], vec![255], vec![b'x'; MAX_HTML as usize + 1]] {
        fs::write(base.join("design.html"), bytes).unwrap();
        assert!(store.resolve(&owner("turn"), &base, "design.html").is_err());
    }
}
#[test]
fn per_turn_budget_does_not_prevent_existing_snapshot_reads() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    for index in 0..32 {
        let name = format!("{index}.html");
        fs::write(base.join(&name), "html").unwrap();
        store.resolve(&owner("turn"), &base, &name).unwrap();
    }
    fs::write(base.join("extra.html"), "html").unwrap();
    assert!(store.resolve(&owner("turn"), &base, "extra.html").is_err());
    assert!(store.resolve(&owner("turn"), &base, "0.html").is_ok());
    assert!(store
        .resolve(&owner("other-turn"), &base, "extra.html")
        .is_ok());
}

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-artifact-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn descriptor_snapshot_ignores_path_replacement_and_metadata_survives_pruned_worktree() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let workspace = base.join("workspace");
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("design.html"), "original").unwrap();
    let descriptor = files::directory(&workspace).unwrap();
    fs::rename(&workspace, base.join("moved")).unwrap();
    fs::create_dir(&workspace).unwrap();
    fs::write(workspace.join("design.html"), "foreign").unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    let metadata = store
        .resolve_registered(
            &owner("turn"),
            &workspace,
            &descriptor,
            "design.html",
            || Ok(()),
        )
        .unwrap();
    assert_eq!(
        store.read(&owner("turn"), &metadata.id).unwrap(),
        b"original"
    );
    fs::remove_dir_all(&workspace).unwrap();
    assert_eq!(
        store
            .existing(&owner("turn"), &workspace, "design.html")
            .unwrap(),
        Some(metadata)
    );
}
#[test]
fn authority_revocation_before_commit_does_not_publish_snapshot() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    fs::write(base.join("design.html"), "original").unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    let validations = std::cell::Cell::new(0);
    let result = store.resolve_registered(
        &owner("turn"),
        &base,
        &files::directory(&base).unwrap(),
        "design.html",
        || {
            let count = validations.get();
            validations.set(count + 1);
            if count == 0 {
                Ok(())
            } else {
                Err("revoked".into())
            }
        },
    );
    assert_eq!(result.unwrap_err(), "revoked");
    assert!(store
        .existing(&owner("turn"), &base, "design.html")
        .unwrap()
        .is_none());
}
#[test]
fn crashed_partial_snapshot_is_replaced_without_following_links() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let directory = files::directory(&base).unwrap();
    fs::write(base.join("one.artifact.part"), "incomplete").unwrap();
    files::write(&directory, "one.artifact", b"complete").unwrap();
    assert_eq!(fs::read(base.join("one.artifact")).unwrap(), b"complete");
    fs::write(base.join("secret"), "secret").unwrap();
    symlink(base.join("secret"), base.join("two.artifact.part")).unwrap();
    files::write(&directory, "two.artifact", b"new").unwrap();
    assert_eq!(fs::read(base.join("secret")).unwrap(), b"secret");
}

#[test]
fn decoded_pixel_budget_rejects_small_compressed_raster_bombs() {
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    png.extend(16_000u32.to_be_bytes());
    png.extend(16_000u32.to_be_bytes());
    assert!(verify("image/png", &png).is_err());
    png[16..20].copy_from_slice(&4_000u32.to_be_bytes());
    png[20..24].copy_from_slice(&4_000u32.to_be_bytes());
    assert!(verify("image/png", &png).is_ok());
}

#[test]
fn final_turn_slot_recovers_orphan_partial_before_capacity_accounting() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let store = OutputArtifactStore::new(base.join("storage"));
    let mut last = None;
    for index in 0..32 {
        let name = format!("{index}.html");
        fs::write(base.join(&name), "html").unwrap();
        last = Some(store.resolve(&owner("turn"), &base, &name).unwrap());
    }
    let id = last.unwrap().id;
    fs::rename(
        store.directory.join(format!("{id}.artifact")),
        store.directory.join(format!("{id}.artifact.part")),
    )
    .unwrap();
    assert!(store.resolve(&owner("turn"), &base, "31.html").is_ok());
}

#[test]
fn two_turns_keep_distinct_immutable_versions_of_the_same_file_after_restart() {
    let temp = Temp::new();
    let base = temp.path().canonicalize().unwrap();
    let workspace = base.join("workspace");
    fs::create_dir(&workspace).unwrap();
    let storage = base.join("storage");
    let store = OutputArtifactStore::new(storage.clone());
    fs::write(workspace.join("design.html"), "<h1>First design</h1>").unwrap();
    let first = store
        .resolve(&owner("turn-first"), &workspace, "design.html")
        .unwrap();
    fs::write(workspace.join("design.html"), "<h1>Revised design</h1>").unwrap();
    let second = store
        .resolve(&owner("turn-second"), &workspace, "design.html")
        .unwrap();
    assert_ne!(first.id, second.id);
    assert_ne!(first.sha256, second.sha256);
    drop(store);
    fs::remove_dir_all(&workspace).unwrap();
    let reopened = OutputArtifactStore::new(storage);
    assert_eq!(
        reopened.read(&owner("turn-first"), &first.id).unwrap(),
        b"<h1>First design</h1>"
    );
    assert_eq!(
        reopened.read(&owner("turn-second"), &second.id).unwrap(),
        b"<h1>Revised design</h1>"
    );
    assert_eq!(
        reopened
            .existing(&owner("turn-first"), &workspace, "design.html")
            .unwrap(),
        Some(first.clone())
    );
    assert_eq!(
        reopened
            .existing(&owner("turn-second"), &workspace, "design.html")
            .unwrap(),
        Some(second.clone())
    );
    assert!(reopened.read(&owner("turn-second"), &first.id).is_err());
    assert!(reopened.read(&owner("turn-first"), &second.id).is_err());
}
