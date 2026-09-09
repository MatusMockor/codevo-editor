use super::{TerminalLaunchDirectory, TerminalLaunchTarget};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use crate::debug_session_registry::DebugWorkspaceAuthority;
use crate::debug_session_registry::RetainedDebugWorkspaceRoot;
use crate::git_worktree::{safe_agent_task_id, WORKTREE_BASE_DIR_NAME};
use crate::workspace_registry::WorkspaceRegistry;
use std::path::{Path, PathBuf};

fn relative_target(repository: &str, thread_id: Option<&str>) -> Result<PathBuf, String> {
    if repository.len() > 4096
        || repository.contains(['\\', '\0'])
        || repository
            .split('/')
            .any(|part| matches!(part, "" | "." | ".."))
    {
        return Err("Invalid terminal repository relative path.".to_string());
    }
    let mut relative = PathBuf::from(repository);
    crate::workspace_registry::validate_relative_path(&relative)
        .map_err(|error| error.to_string())?;
    if let Some(thread_id) = thread_id {
        relative.push(WORKTREE_BASE_DIR_NAME);
        relative.push(safe_agent_task_id(thread_id)?);
    }
    Ok(relative)
}

pub(super) fn resolve(
    workspace_root: &Path,
    repository: &str,
    thread_id: Option<&str>,
) -> Result<PathBuf, String> {
    Ok(workspace_root.join(relative_target(repository, thread_id)?))
}

pub(super) fn open(
    registry: &WorkspaceRegistry,
    retained_workspace: &RetainedDebugWorkspaceRoot,
    workspace_root: &Path,
    target: &TerminalLaunchTarget,
) -> Option<Result<TerminalLaunchDirectory, String>> {
    let (repository, thread_id) = match target {
        TerminalLaunchTarget::RepositoryRoot {
            repository_relative_path,
        } => (repository_relative_path.as_str(), None),
        TerminalLaunchTarget::RepositoryAgentWorktree {
            repository_relative_path,
            thread_id,
        } => (repository_relative_path.as_str(), Some(thread_id.as_str())),
        TerminalLaunchTarget::WorkspaceRoot | TerminalLaunchTarget::AgentWorktree { .. } => {
            return None
        }
    };
    Some(open_repository(
        registry,
        retained_workspace,
        workspace_root,
        repository,
        thread_id,
    ))
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn open_repository(
    registry: &WorkspaceRegistry,
    retained_workspace: &RetainedDebugWorkspaceRoot,
    workspace_root: &Path,
    repository: &str,
    thread_id: Option<&str>,
) -> Result<TerminalLaunchDirectory, String> {
    let relative = relative_target(repository, thread_id)?;
    let descriptor = registry
        .descriptor_for_registered_path(workspace_root)
        .map_err(|error| error.to_string())?;
    let expected_authority = DebugWorkspaceAuthority::RetainedWorkspace {
        workspace_id: descriptor.workspace_id.as_str().to_string(),
        canonical_root: workspace_root.to_string_lossy().into_owned(),
    };
    if retained_workspace.authority != expected_authority
        || retained_workspace.live_path()? != workspace_root
    {
        return Err("Terminal workspace identity changed before launch.".to_string());
    }
    let directory = registry
        .open_directory_descendant(&descriptor.workspace_id, &relative)
        .map_err(|_| "The terminal repository or checkout is unavailable.".to_string())?;
    let cwd = workspace_root.join(relative);
    if super::opened_launch_directory_path(&directory)? != cwd {
        return Err("Terminal repository identity changed before launch.".to_string());
    }
    Ok(TerminalLaunchDirectory { cwd, directory })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn open_repository(
    _registry: &WorkspaceRegistry,
    _retained_workspace: &RetainedDebugWorkspaceRoot,
    _workspace_root: &Path,
    _repository: &str,
    _thread_id: Option<&str>,
) -> Result<TerminalLaunchDirectory, String> {
    Err("Starting a terminal in a nested repository is not supported on this platform.".to_string())
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn open_repository(
        registry: &WorkspaceRegistry,
        root: &Path,
        repository: &str,
        thread_id: Option<&str>,
    ) -> Result<TerminalLaunchDirectory, String> {
        let retained = crate::debug_session_registry::retain_workspace_root(
            registry,
            &root.to_string_lossy(),
        )?;
        super::open_repository(registry, &retained, root, repository, thread_id)
    }

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "codevo-terminal-repository-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn nested_targets_keep_the_registered_root_and_open_the_exact_checkout() {
        let root = Fixture::new();
        let repository = root.path().join("packages/backend");
        let worktree = repository.join(WORKTREE_BASE_DIR_NAME).join("agt-0001");
        fs::create_dir_all(&worktree).unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(root.path()).unwrap();
        let root = descriptor.canonical_root_path;
        for thread in [None, Some("agt-0001")] {
            let opened = open_repository(&registry, &root, "packages/backend", thread).unwrap();
            let expected = resolve(&root, "packages/backend", thread).unwrap();
            assert_eq!(opened.cwd, expected);
            assert_eq!(
                super::super::opened_launch_directory_path(&opened.directory).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn nested_targets_reject_escapes_and_unbounded_paths() {
        for path in [
            "",
            "/tmp",
            "../outside",
            "pkg/../outside",
            "pkg//repo",
            "pkg/./repo",
            "pkg/",
            "pkg\\repo",
            "pkg\0repo",
        ] {
            assert!(relative_target(path, None).is_err(), "{path:?}");
        }
        assert!(relative_target(&"é".repeat(2049), None).is_err());
        assert!(relative_target("repo", Some("../escape")).is_err());
    }

    #[test]
    fn nested_targets_reject_symlink_repositories_and_missing_checkouts() {
        let root = Fixture::new();
        let outside = Fixture::new();
        fs::create_dir_all(outside.path().join(WORKTREE_BASE_DIR_NAME).join("agt-0001")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("linked")).unwrap();
        fs::create_dir_all(root.path().join("real")).unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(root.path()).unwrap();
        let root = descriptor.canonical_root_path;
        for thread in [None, Some("agt-0001")] {
            assert!(open_repository(&registry, &root, "linked", thread).is_err());
        }
        assert!(open_repository(&registry, &root, "real", Some("agt-missing")).is_err());
        std::os::unix::fs::symlink(
            outside.path().join(WORKTREE_BASE_DIR_NAME),
            root.join("real").join(WORKTREE_BASE_DIR_NAME),
        )
        .unwrap();
        assert!(open_repository(&registry, &root, "real", Some("agt-0001")).is_err());
    }

    #[test]
    fn nested_targets_reject_retired_and_replaced_project_owners() {
        let fixture = Fixture::new();
        let selected = fixture.path().join("project");
        fs::create_dir_all(selected.join("repo")).unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(&selected).unwrap();
        let root = descriptor.canonical_root_path;
        fs::rename(&root, fixture.path().join("old-project")).unwrap();
        fs::create_dir_all(root.join("repo")).unwrap();
        assert!(open_repository(&registry, &root, "repo", None).is_err());
        registry.unregister(&descriptor.workspace_id).unwrap();
        assert!(open_repository(&registry, &root, "repo", None).is_err());
    }

    #[test]
    fn a_nested_launch_cannot_adopt_a_reregistered_workspace_owner() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.path().join("repo")).unwrap();
        let registry = WorkspaceRegistry::new();
        let descriptor = registry.register(fixture.path()).unwrap();
        let root = descriptor.canonical_root_path;
        let retained = crate::debug_session_registry::retain_workspace_root(
            &registry,
            &root.to_string_lossy(),
        )
        .unwrap();
        registry.unregister(&descriptor.workspace_id).unwrap();
        let replacement = registry.register(&root).unwrap();
        assert_ne!(replacement.workspace_id, descriptor.workspace_id);
        let target = TerminalLaunchTarget::RepositoryRoot {
            repository_relative_path: "repo".into(),
        };
        assert!(
            super::super::open_terminal_launch_directory(&registry, &retained, &root, &target)
                .is_err()
        );
    }

    #[test]
    fn repository_wire_contract_rejects_unknown_fields() {
        let valid = r#"{"kind":"repositoryAgentWorktree","repositoryRelativePath":"repo","threadId":"agt-0001"}"#;
        let target = serde_json::from_str::<TerminalLaunchTarget>(valid).unwrap();
        assert_eq!(serde_json::to_string(&target).unwrap(), valid);
        for invalid in [
            r#"{"kind":"repositoryRoot"}"#,
            r#"{"kind":"repositoryRoot","repositoryRelativePath":"repo","cwd":"/etc"}"#,
            r#"{"kind":"repositoryAgentWorktree","repositoryRelativePath":"repo"}"#,
        ] {
            assert!(serde_json::from_str::<TerminalLaunchTarget>(invalid).is_err());
        }
    }
}
