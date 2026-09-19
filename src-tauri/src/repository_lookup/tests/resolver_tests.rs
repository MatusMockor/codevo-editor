use std::fs;
use std::os::unix::fs::PermissionsExt;

use super::super::resolver::{resolve_trusted_on_search_path, PathTrust};
use super::fake_cli::FakeCliDirectory;

fn current_uid() -> u32 {
    // SAFETY: `getuid` reads the calling process identity and never fails.
    unsafe { libc::getuid() }
}

fn search_path(directory: &FakeCliDirectory) -> String {
    directory.base().to_string_lossy().into_owned()
}

#[test]
fn an_executable_in_a_private_directory_owned_by_the_user_resolves() {
    let directory = FakeCliDirectory::create("resolver-private");
    let script = directory.script("gh", "exit 0");

    let resolved =
        resolve_trusted_on_search_path(&search_path(&directory), "gh", PathTrust::current());

    assert_eq!(resolved, fs::canonicalize(script).ok());
}

#[test]
fn a_group_or_world_writable_directory_owned_by_a_foreign_user_is_skipped() {
    let directory = FakeCliDirectory::create("resolver-writable");
    directory.script("gh", "exit 0");
    fs::set_permissions(directory.base(), fs::Permissions::from_mode(0o777))
        .expect("widen the fake cli directory");

    let foreign = PathTrust::owned_by(current_uid().wrapping_add(1));

    assert_eq!(
        resolve_trusted_on_search_path(&search_path(&directory), "gh", foreign),
        None
    );
    assert!(
        resolve_trusted_on_search_path(&search_path(&directory), "gh", PathTrust::current())
            .is_some()
    );
}

#[test]
fn an_executable_owned_by_a_foreign_user_is_skipped() {
    let directory = FakeCliDirectory::create("resolver-foreign-file");
    directory.script("gh", "exit 0");
    let foreign = PathTrust::owned_by(current_uid().wrapping_add(1));

    assert_eq!(
        resolve_trusted_on_search_path(&search_path(&directory), "gh", foreign),
        None
    );
}

#[test]
fn a_non_executable_candidate_is_skipped() {
    let directory = FakeCliDirectory::create("resolver-not-executable");
    let path = directory.file("gh");
    fs::write(&path, b"#!/bin/sh\nexit 0\n").expect("write candidate");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).expect("drop the executable bit");

    assert_eq!(
        resolve_trusted_on_search_path(&search_path(&directory), "gh", PathTrust::current()),
        None
    );
}

#[test]
fn relative_search_path_entries_are_ignored() {
    let directory = FakeCliDirectory::create("resolver-relative");
    directory.script("gh", "exit 0");
    let relative = format!("relative/bin:{}", search_path(&directory));

    assert!(resolve_trusted_on_search_path(&relative, "gh", PathTrust::current()).is_some());
    assert_eq!(
        resolve_trusted_on_search_path("relative/bin", "gh", PathTrust::current()),
        None
    );
}
