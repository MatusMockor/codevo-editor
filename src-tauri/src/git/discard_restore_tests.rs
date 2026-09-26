use super::place_no_clobber;
use crate::git::file_discard::DISCARD_PATH_BLOCKED_ERROR;
use crate::git::working_tree_test_repo::TestRepo;
use std::{
    io,
    os::unix::fs::{symlink, PermissionsExt},
    path::Path,
};

fn cross_device(_from: &Path, _to: &Path) -> io::Result<()> {
    Err(io::Error::from_raw_os_error(libc::EXDEV))
}

#[test]
fn a_cross_device_restore_copies_the_file_with_its_mode() {
    let repo = TestRepo::new("restore-exdev-file");
    repo.write("staged/run.sh", "#!/bin/sh\n");
    let staged = repo.path().join("staged/run.sh");
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let target = repo.path().join("run.sh");

    place_no_clobber(&staged, &target, false, cross_device).expect("copy fallback");

    assert_eq!(repo.read("run.sh").as_deref(), Some("#!/bin/sh\n"));
    let mode = std::fs::metadata(&target)
        .expect("restored")
        .permissions()
        .mode();
    assert_eq!(mode & 0o111, 0o111);
}

#[test]
fn a_cross_device_restore_recreates_a_symlink() {
    let repo = TestRepo::new("restore-exdev-link");
    std::fs::create_dir_all(repo.path().join("staged")).expect("staged dir");
    symlink("target.txt", repo.path().join("staged/link")).expect("staged link");
    let target = repo.path().join("link");

    place_no_clobber(
        &repo.path().join("staged/link"),
        &target,
        true,
        cross_device,
    )
    .expect("symlink fallback");

    assert_eq!(
        std::fs::read_link(&target).expect("a symlink"),
        Path::new("target.txt")
    );
}

#[test]
fn a_cross_device_restore_never_overwrites_what_is_already_there() {
    let repo = TestRepo::new("restore-exdev-occupied");
    repo.write("staged/a.txt", "from head\n");
    repo.write("a.txt", "precious\n");
    std::fs::create_dir_all(repo.path().join("staged-link")).expect("dir");
    symlink("elsewhere", repo.path().join("staged-link/b")).expect("staged link");
    repo.write("b", "precious b\n");

    let file = place_no_clobber(
        &repo.path().join("staged/a.txt"),
        &repo.path().join("a.txt"),
        false,
        cross_device,
    );
    let link = place_no_clobber(
        &repo.path().join("staged-link/b"),
        &repo.path().join("b"),
        true,
        cross_device,
    );

    assert_eq!(
        file.expect_err("occupied").to_string(),
        DISCARD_PATH_BLOCKED_ERROR
    );
    assert_eq!(
        link.expect_err("occupied").to_string(),
        DISCARD_PATH_BLOCKED_ERROR
    );
    assert_eq!(repo.read("a.txt").as_deref(), Some("precious\n"));
    assert_eq!(repo.read("b").as_deref(), Some("precious b\n"));
}
