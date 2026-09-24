use super::ProcessHomeDirectory;
use super::{
    home_from_environment, home_from_password_database, FileIdentity, FileIdentityProbe,
    HomeDirectorySource, ProtectedPathPolicy, WorkspaceRootRefusal,
};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

struct FixedHome(Option<PathBuf>);

impl HomeDirectorySource for FixedHome {
    fn home_directory(&self) -> Option<PathBuf> {
        self.0.clone()
    }
}

fn temp_home(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let home = std::env::temp_dir().join(format!("codevo-protected-{label}-{suffix}/me"));
    fs::create_dir_all(&home).expect("temp home");
    home.canonicalize().expect("canonical home")
}

#[test]
fn environment_home_must_be_present_non_empty_and_absolute() {
    assert_eq!(home_from_environment(None), None);
    assert_eq!(home_from_environment(Some(OsString::new())), None);
    assert_eq!(
        home_from_environment(Some(OsString::from("relative/home"))),
        None
    );
    assert_eq!(
        home_from_environment(Some(OsString::from("/Users/me"))),
        Some(PathBuf::from("/Users/me"))
    );
}

#[cfg(unix)]
#[test]
fn password_database_fallback_resolves_an_absolute_home() {
    let home = home_from_password_database().expect("password database home");

    assert!(home.is_absolute());
}

#[test]
fn filesystem_root_is_refused_even_without_a_home() {
    let policy = ProtectedPathPolicy::from_source(&FixedHome(None));

    assert_eq!(
        policy.check_workspace_root(Path::new("/")),
        Err(WorkspaceRootRefusal::FilesystemRoot)
    );
    assert_eq!(
        policy.check_workspace_root(Path::new("/tmp/project")),
        Ok(())
    );
}

#[test]
fn home_and_its_ancestors_are_refused_as_workspace_roots() {
    let home = temp_home("roots");
    let policy = ProtectedPathPolicy::from_source(&FixedHome(Some(home.clone())));
    let parent = home.parent().expect("home parent");

    assert_eq!(
        policy.check_workspace_root(&home),
        Err(WorkspaceRootRefusal::Home)
    );
    assert_eq!(
        policy.check_workspace_root(parent),
        Err(WorkspaceRootRefusal::HomeAncestor)
    );
    assert_eq!(
        policy.check_workspace_root(Path::new("/")),
        Err(WorkspaceRootRefusal::FilesystemRoot)
    );
    assert_eq!(policy.check_workspace_root(&home.join("Documents")), Ok(()));
    assert_eq!(
        policy.check_workspace_root(&home.join("Documents/project")),
        Ok(())
    );
    assert_eq!(policy.check_workspace_root(&parent.join("me2")), Ok(()));
}

#[cfg(target_os = "macos")]
#[test]
fn home_comparison_is_case_insensitive_on_macos() {
    let home = temp_home("case");
    let policy = ProtectedPathPolicy::for_home(Some(&home));
    let upper = PathBuf::from(home.to_string_lossy().to_uppercase());

    assert_eq!(
        policy.check_workspace_root(&upper),
        Err(WorkspaceRootRefusal::Home)
    );
    assert!(policy.is_protected_directory(&home.join("MUSIC")));
}

#[cfg(target_os = "macos")]
#[test]
fn only_direct_privacy_protected_home_children_are_protected() {
    let home = temp_home("children");
    let policy = ProtectedPathPolicy::from_source(&FixedHome(Some(home.clone())));

    assert!(policy.is_protected_directory(&home.join("Music")));
    assert!(policy.is_protected_directory(&home.join("Documents")));
    assert!(policy.is_protected_directory(&home.join("Library")));
    assert!(!policy.is_protected_directory(&home.join("Developer")));
    assert!(!policy.is_protected_directory(&home.join("Documents/project")));
    assert!(!policy.is_protected_directory(&home.join("Developer/Music")));
    assert!(!policy.is_protected_directory(&home));
}

#[test]
fn unprotected_policy_protects_nothing() {
    let policy = ProtectedPathPolicy::unprotected();

    assert!(!policy.is_protected_directory(Path::new("/Users/me/Music")));
}

fn aliased_identity(path: &Path) -> Option<FileIdentity> {
    match path.to_str()? {
        "/Users/me" | "/Volumes/Data/Users/me" => Some(FileIdentity::new(7, 100)),
        "/Users" | "/Volumes/Data/Users" => Some(FileIdentity::new(7, 50)),
        "/Volumes/Data" => Some(FileIdentity::new(7, 2)),
        "/Users/me/Music" | "/Volumes/Data/Users/me/Music" => Some(FileIdentity::new(7, 101)),
        "/Users/me/Developer/Users/me" => Some(FileIdentity::new(7, 100)),
        _ => None,
    }
}

fn aliased_resolve(path: &Path) -> Option<PathBuf> {
    match path.to_str()? {
        "/Users/me/Developer/Users/me" => Some(PathBuf::from("/Users/me")),
        _ => Some(path.to_path_buf()),
    }
}

fn aliased_policy() -> ProtectedPathPolicy {
    ProtectedPathPolicy::with_probe(
        Some(Path::new("/Users/me")),
        FileIdentityProbe::new(aliased_identity, aliased_resolve),
    )
}

#[test]
fn identity_alias_of_home_is_refused_as_home() {
    assert_eq!(
        aliased_policy().check_workspace_root(Path::new("/Volumes/Data/Users/me")),
        Err(WorkspaceRootRefusal::Home)
    );
}

#[test]
fn identity_alias_ancestors_of_home_are_refused() {
    let policy = aliased_policy();

    assert_eq!(
        policy.check_workspace_root(Path::new("/Volumes/Data")),
        Err(WorkspaceRootRefusal::HomeAncestor)
    );
    assert_eq!(
        policy.check_workspace_root(Path::new("/Volumes/Data/Users")),
        Err(WorkspaceRootRefusal::HomeAncestor)
    );
}

#[test]
fn symlink_to_home_inside_a_project_does_not_make_the_project_an_ancestor() {
    assert_eq!(
        aliased_policy().check_workspace_root(Path::new("/Users/me/Developer")),
        Ok(())
    );
}

#[cfg(target_os = "macos")]
#[test]
fn protected_children_under_an_identity_alias_of_home_are_protected() {
    let policy = aliased_policy();

    assert!(policy.is_protected_directory(Path::new("/Volumes/Data/Users/me/Music")));
    assert!(!policy.is_protected_directory(Path::new("/Volumes/Data/Users/Music")));
}

#[cfg(target_os = "macos")]
#[test]
fn real_data_volume_firmlink_aliases_of_home_are_refused() {
    let Some(home) = ProcessHomeDirectory.home_directory() else {
        return;
    };
    let home = home.canonicalize().expect("canonical home");
    let data = Path::new("/System/Volumes/Data");
    let aliased_home = data.join(home.strip_prefix("/").expect("absolute home"));
    if !aliased_home.is_dir() {
        return;
    }
    let policy = ProtectedPathPolicy::for_home(Some(&home));

    assert_eq!(
        policy.check_workspace_root(&aliased_home),
        Err(WorkspaceRootRefusal::Home)
    );
    assert_eq!(
        policy.check_workspace_root(data),
        Err(WorkspaceRootRefusal::HomeAncestor)
    );
    assert!(policy.is_protected_directory(&aliased_home.join("Music")));
}
