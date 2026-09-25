use super::*;
use std::sync::atomic::{AtomicU64, Ordering};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "codevo-clone-cleanup-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn reserve(&self) -> Destination {
        Destination::reserve(self.0.to_str().unwrap(), "clone", false).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn removes_nested_partial_clone_without_following_symlinks() {
    let fixture = Fixture::new();
    let outside = fixture.0.join("outside");
    std::fs::create_dir(&outside).unwrap();
    std::fs::write(outside.join("keep"), "safe").unwrap();
    let destination = fixture.reserve();
    let root = std::path::Path::new(&destination.path);
    std::fs::create_dir_all(root.join("nested/deeper")).unwrap();
    std::fs::write(root.join("nested/deeper/data"), "partial").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
    destination.cleanup().unwrap();
    assert!(!root.exists());
    assert_eq!(
        std::fs::read_to_string(outside.join("keep")).unwrap(),
        "safe"
    );
}

#[test]
fn replaced_destination_is_preserved() {
    let fixture = Fixture::new();
    let destination = fixture.reserve();
    std::fs::rename(&destination.path, fixture.0.join("original")).unwrap();
    std::fs::create_dir(&destination.path).unwrap();
    std::fs::write(std::path::Path::new(&destination.path).join("keep"), "safe").unwrap();
    assert!(destination.cleanup().is_err());
    assert!(std::path::Path::new(&destination.path)
        .join("keep")
        .exists());
}

#[test]
fn replaced_parent_is_preserved() {
    let fixture = Fixture::new();
    let parent = fixture.0.join("parent");
    std::fs::create_dir(&parent).unwrap();
    let destination = Destination::reserve(parent.to_str().unwrap(), "clone", false).unwrap();
    std::fs::rename(&parent, fixture.0.join("old-parent")).unwrap();
    std::fs::create_dir_all(parent.join("clone")).unwrap();
    assert!(destination.cleanup().is_err());
    assert!(parent.join("clone").exists());
}

#[test]
fn entry_budget_and_deadline_fail_truthfully() {
    let fixture = Fixture::new();
    let destination = fixture.reserve();
    std::fs::write(std::path::Path::new(&destination.path).join("keep"), "safe").unwrap();
    let mut budget = CleanupBudget {
        remaining: 1,
        deadline: std::time::Instant::now() + std::time::Duration::from_secs(10),
    };
    assert!(clear_directory(&destination.directory, 0, &mut budget)
        .unwrap_err()
        .contains("limit"));
    assert!(std::path::Path::new(&destination.path)
        .join("keep")
        .exists());
    let mut budget = CleanupBudget {
        remaining: 100,
        deadline: std::time::Instant::now(),
    };
    assert!(clear_directory(&destination.directory, 0, &mut budget).is_err());
    assert!(std::path::Path::new(&destination.path)
        .join("keep")
        .exists());
}

#[test]
fn depth_bound_preserves_remaining_directory() {
    let fixture = Fixture::new();
    let destination = fixture.reserve();
    let mut path = PathBuf::from(&destination.path);
    for _ in 0..66 {
        path.push("d");
        std::fs::create_dir(&path).unwrap();
    }
    std::fs::write(path.join("keep"), "safe").unwrap();
    assert!(destination.cleanup().unwrap_err().contains("limit"));
    assert!(path.join("keep").exists());
}

#[test]
fn rejects_traversal_and_preserves_existing_destination() {
    let fixture = Fixture::new();
    for name in ["", ".", "..", "../escape", "nested/child"] {
        assert!(Destination::reserve(fixture.0.to_str().unwrap(), name, false).is_err());
    }
    let destination = fixture.reserve();
    assert!(Destination::reserve(fixture.0.to_str().unwrap(), "clone", false).is_err());
    assert!(destination.verify().is_ok());
    drop(destination);
    assert!(fixture.0.join("clone").exists());
}

#[test]
fn existing_destination_is_not_overwritten_and_staging_is_removed() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("clone")).unwrap();
    std::fs::write(fixture.0.join("clone/keep"), "safe").unwrap();
    assert!(Destination::reserve(fixture.0.to_str().unwrap(), "clone", false).is_err());
    assert_eq!(
        std::fs::read_to_string(fixture.0.join("clone/keep")).unwrap(),
        "safe"
    );
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn staging_collision_preserves_the_existing_private_entry() {
    let fixture = Fixture::new();
    let parent = File::open(&fixture.0).unwrap();
    let name = CString::new(".codevo-clone-collision").unwrap();
    std::fs::create_dir(fixture.0.join(name.to_str().unwrap())).unwrap();
    std::fs::write(fixture.0.join(name.to_str().unwrap()).join("keep"), "safe").unwrap();
    assert!(reservation::reserve_staging(&parent, &name).is_err());
    assert!(fixture.0.join(name.to_str().unwrap()).join("keep").exists());
}

#[test]
fn failed_publication_removes_only_owned_staging() {
    let fixture = Fixture::new();
    let parent = File::open(&fixture.0).unwrap();
    let name = reservation::staging_name().unwrap();
    let target = CString::new("clone").unwrap();
    let staging = reservation::reserve_staging(&parent, &name).unwrap();
    std::fs::write(fixture.0.join("clone"), "safe").unwrap();
    assert!(reservation::publish_staging(&parent, &name, &target).is_err());
    drop(staging);
    assert!(!fixture.0.join(name.to_str().unwrap()).exists());
    assert_eq!(
        std::fs::read_to_string(fixture.0.join("clone")).unwrap(),
        "safe"
    );
}

#[test]
fn ensure_parent_creates_one_missing_level_under_home_only() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    std::fs::create_dir(&home).unwrap();
    let code = home.join("code");
    let created = prepare_parent(code.to_str().unwrap(), true, Some(&home)).unwrap();
    assert!(code.is_dir());
    assert_eq!(created.path, std::fs::canonicalize(&code).unwrap());
    assert!(prepare_parent(code.to_str().unwrap(), true, Some(&home)).is_ok());
    let nested = home.join("a").join("b");
    assert!(prepare_parent(nested.to_str().unwrap(), true, Some(&home)).is_err());
    assert!(!home.join("a").exists());
    let outside = fixture.0.join("elsewhere");
    assert!(prepare_parent(outside.to_str().unwrap(), true, Some(&home)).is_err());
    assert!(!outside.exists());
    let missing = home.join("other");
    assert!(prepare_parent(missing.to_str().unwrap(), false, Some(&home)).is_err());
    assert!(!missing.exists());
    assert!(prepare_parent(
        home.join("..").join("x").to_str().unwrap(),
        true,
        Some(&home)
    )
    .is_err());
    assert!(!fixture.0.join("x").exists());
}

#[test]
fn ensure_parent_only_creates_the_code_folder() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    std::fs::create_dir(&home).unwrap();
    for name in ["other", "Code", "code2", ".code"] {
        let requested = home.join(name);
        assert!(prepare_parent(requested.to_str().unwrap(), true, Some(&home)).is_err());
        assert!(!requested.exists());
    }
    let dotted = format!("{}/../home/code", home.to_str().unwrap());
    assert!(prepare_parent(&dotted, true, Some(&home)).is_err());
    assert!(!home.join("code").exists());
    assert!(prepare_parent("code", true, Some(&home)).is_err());
    assert!(prepare_parent(home.join("code").to_str().unwrap(), true, None).is_err());
    assert!(!home.join("code").exists());
}

#[test]
fn ensure_parent_refuses_symlinked_home_aliases_and_dangling_links() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    std::fs::create_dir(&home).unwrap();
    let alias = fixture.0.join("home-alias");
    std::os::unix::fs::symlink(&home, &alias).unwrap();
    assert!(prepare_parent(alias.join("code").to_str().unwrap(), true, Some(&home)).is_err());
    assert!(!home.join("code").exists());
    let missing_target = fixture.0.join("missing-target");
    std::os::unix::fs::symlink(&missing_target, home.join("code")).unwrap();
    assert!(prepare_parent(home.join("code").to_str().unwrap(), true, Some(&home)).is_err());
    assert!(!missing_target.exists());
    assert!(std::fs::symlink_metadata(home.join("code"))
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn ensure_parent_accepts_a_symlinked_home_given_as_home() {
    let fixture = Fixture::new();
    let real_home = fixture.0.join("real-home");
    std::fs::create_dir(&real_home).unwrap();
    let home = fixture.0.join("home");
    std::os::unix::fs::symlink(&real_home, &home).unwrap();
    let created = prepare_parent(home.join("code").to_str().unwrap(), true, Some(&home)).unwrap();
    assert_eq!(
        created.path,
        std::fs::canonicalize(real_home.join("code")).unwrap()
    );
}

#[test]
fn ensure_parent_uses_an_existing_symlinked_parent_without_creating() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    let target = fixture.0.join("target");
    std::fs::create_dir(&home).unwrap();
    std::fs::create_dir(&target).unwrap();
    std::os::unix::fs::symlink(&target, home.join("code")).unwrap();
    let resolved = prepare_parent(home.join("code").to_str().unwrap(), true, Some(&home)).unwrap();
    assert_eq!(resolved.path, std::fs::canonicalize(&target).unwrap());
}

#[test]
fn reserve_with_ensure_parent_creates_code_then_the_clone_folder() {
    let fixture = Fixture::new();
    let home = fixture.0.join("home");
    std::fs::create_dir(&home).unwrap();
    let code = home.join("code");
    let destination =
        Destination::reserve_under(code.to_str().unwrap(), "repo", true, Some(&home)).unwrap();
    assert_eq!(
        std::path::Path::new(&destination.path),
        std::fs::canonicalize(&home).unwrap().join("code/repo")
    );
    assert!(destination.verify().is_ok());
    let missing = home.join("missing");
    assert!(
        Destination::reserve_under(missing.to_str().unwrap(), "repo", false, Some(&home)).is_err()
    );
    assert!(!missing.exists());
}

#[test]
fn reserve_refuses_home_and_home_ancestors_as_the_clone_root() {
    let fixture = Fixture::new();
    let base = std::fs::canonicalize(&fixture.0).unwrap();
    let parent = base.to_str().unwrap();
    let home = base.join("future-home");
    let refusal = Destination::reserve_under(parent, "future-home", false, Some(&home))
        .err()
        .unwrap();
    assert_eq!(
        refusal,
        crate::workspace::protected_paths::WorkspaceRootRefusal::Home.to_string()
    );
    assert!(!home.exists());
    let nested_home = base.join("outer").join("inner");
    let refusal = Destination::reserve_under(parent, "outer", false, Some(&nested_home))
        .err()
        .unwrap();
    assert_eq!(
        refusal,
        crate::workspace::protected_paths::WorkspaceRootRefusal::HomeAncestor.to_string()
    );
    assert!(!fixture.0.join("outer").exists());
    assert!(Destination::reserve_under(parent, "sibling", false, Some(&home)).is_ok());
    assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
}

#[test]
fn swapping_the_ensured_parent_after_preparation_cannot_redirect_the_reservation() {
    for replace_with_symlink in [false, true] {
        let fixture = Fixture::new();
        let home = fixture.0.join("home");
        std::fs::create_dir(&home).unwrap();
        let code = home.join("code");
        let prepared = prepare_parent(code.to_str().unwrap(), true, Some(&home)).unwrap();
        let original = fixture.0.join("original-code");
        std::fs::rename(&code, &original).unwrap();
        let redirected = fixture.0.join("redirected");
        std::fs::create_dir(&redirected).unwrap();
        if replace_with_symlink {
            std::os::unix::fs::symlink(&redirected, &code).unwrap();
        } else {
            std::fs::rename(&redirected, &code).unwrap();
        }
        let target = if replace_with_symlink {
            &redirected
        } else {
            &code
        };

        assert!(Destination::reserve_in(prepared, "repo", Some(&home)).is_err());
        assert_eq!(std::fs::read_dir(target).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(&original).unwrap().count(), 0);
    }
}
