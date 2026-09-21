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
        Destination::reserve(self.0.to_str().unwrap(), "clone").unwrap()
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
    let destination = Destination::reserve(parent.to_str().unwrap(), "clone").unwrap();
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
        assert!(Destination::reserve(fixture.0.to_str().unwrap(), name).is_err());
    }
    let destination = fixture.reserve();
    assert!(Destination::reserve(fixture.0.to_str().unwrap(), "clone").is_err());
    assert!(destination.verify().is_ok());
    drop(destination);
    assert!(fixture.0.join("clone").exists());
}

#[test]
fn existing_destination_is_not_overwritten_and_staging_is_removed() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("clone")).unwrap();
    std::fs::write(fixture.0.join("clone/keep"), "safe").unwrap();
    assert!(Destination::reserve(fixture.0.to_str().unwrap(), "clone").is_err());
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
