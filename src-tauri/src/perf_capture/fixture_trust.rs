use super::{error, tokens_equal, valid_config_token};
use crate::trust::WorkspaceTrustService;
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::{
    fs::{self, Metadata},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};

const WORK_ROOT_ENV: Option<&str> = option_env!("CODEVO_PERF_CAPTURE_WORK_ROOT");
const MAX_WORK_ROOT_BYTES: usize = 4 * 1024;
const FIXTURE_RELATIVE_ROOTS: [[&str; 3]; 2] = [
    ["perf", "fixtures", "large-files"],
    ["perf", "fixtures", "monorepo"],
];

#[derive(Clone)]
struct FixtureTrustConfig {
    run_token: String,
    work_root: PathBuf,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PathIdentity {
    canonical_path: PathBuf,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ResolvedFixtureRoots {
    guarded_paths: Vec<PathIdentity>,
    roots: [PathBuf; 2],
}

#[derive(Clone, Debug)]
struct RetainedFixtureRoots {
    workspace_ids: [WorkspaceId; 2],
    identities: [PathIdentity; 2],
}

pub(super) async fn trust_fixture_workspaces<R: tauri::Runtime>(
    app: AppHandle<R>,
    run_token: String,
) -> Result<(), String> {
    let config = compile_time_config()?;
    authenticate(&config, &run_token)?;

    tauri::async_runtime::spawn_blocking(move || trust_fixture_workspaces_blocking(&app, &config))
        .await
        .map_err(|_| error("Performance capture fixture trust worker failed."))?
}

fn authenticate(config: &FixtureTrustConfig, candidate: &str) -> Result<(), String> {
    if !tokens_equal(candidate.as_bytes(), config.run_token.as_bytes()) {
        return Err(error("Performance capture fixture trust was rejected."));
    }
    Ok(())
}

fn compile_time_config() -> Result<FixtureTrustConfig, String> {
    let run_token = super::RUN_TOKEN_ENV;
    let work_root = WORK_ROOT_ENV.ok_or_else(fixture_config_error)?;
    if !valid_config_token(run_token) || !valid_work_root(Path::new(work_root)) {
        return Err(fixture_config_error());
    }

    Ok(FixtureTrustConfig {
        run_token: run_token.to_owned(),
        work_root: PathBuf::from(work_root),
    })
}

fn valid_work_root(path: &Path) -> bool {
    let byte_len = path.as_os_str().to_string_lossy().len();
    path.is_absolute()
        && (1..=MAX_WORK_ROOT_BYTES).contains(&byte_len)
        && path
            .components()
            .all(|component| !matches!(component, Component::ParentDir | Component::CurDir))
}

fn trust_fixture_workspaces_blocking<R: tauri::Runtime>(
    app: &AppHandle<R>,
    config: &FixtureTrustConfig,
) -> Result<(), String> {
    trust_fixture_workspaces_blocking_with_hook(app, config, || {})
}

fn trust_fixture_workspaces_blocking_with_hook<R, F>(
    app: &AppHandle<R>,
    config: &FixtureTrustConfig,
    before_trust_commit: F,
) -> Result<(), String>
where
    R: tauri::Runtime,
    F: FnOnce(),
{
    let resolved = resolve_fixture_roots(&config.work_root)?;
    revalidate_fixture_roots(&config.work_root, &resolved)?;
    let registry = app.state::<WorkspaceRegistry>();
    let retained = retain_fixture_roots(&registry, &resolved)?;
    revalidate_fixture_roots(&config.work_root, &resolved)?;
    verify_retained_fixture_roots(&registry, &retained)?;
    before_trust_commit();

    let trust_state = app.state::<Mutex<WorkspaceTrustService>>();
    let mut trust = trust_state
        .lock()
        .map_err(|_| error("Performance capture fixture trust is unavailable."))?;
    let root_strings = fixture_root_strings(&resolved)?;
    trust
        .grant_ephemeral_canonical_roots(root_strings)
        .map_err(|_| error("Performance capture fixture trust could not be granted."))?;

    Ok(())
}

fn resolve_fixture_roots(work_root: &Path) -> Result<ResolvedFixtureRoots, String> {
    if !valid_work_root(work_root) {
        return Err(fixture_config_error());
    }

    let canonical_work_root = checked_directory(work_root)?;
    let mut guarded_paths = vec![identity_for(work_root, canonical_work_root.clone())?];
    let mut current = work_root.to_path_buf();
    for component in ["perf", "fixtures"] {
        current.push(component);
        let expected = canonical_work_root.join(
            current
                .strip_prefix(work_root)
                .map_err(|_| fixture_root_error())?,
        );
        let canonical = checked_directory(&current)?;
        if canonical != expected {
            return Err(fixture_root_error());
        }
        guarded_paths.push(identity_for(&current, canonical)?);
    }

    let roots = FIXTURE_RELATIVE_ROOTS.map(|components| {
        let relative = components.iter().collect::<PathBuf>();
        work_root.join(relative)
    });
    for root in &roots {
        let relative = root
            .strip_prefix(work_root)
            .map_err(|_| fixture_root_error())?;
        let expected = canonical_work_root.join(relative);
        let canonical = checked_directory(root)?;
        if canonical != expected {
            return Err(fixture_root_error());
        }
        guarded_paths.push(identity_for(root, canonical)?);
    }

    let canonical_roots = [
        guarded_paths[3].canonical_path.clone(),
        guarded_paths[4].canonical_path.clone(),
    ];
    if canonical_roots[0] == canonical_roots[1] {
        return Err(fixture_root_error());
    }

    Ok(ResolvedFixtureRoots {
        guarded_paths,
        roots: canonical_roots,
    })
}

fn checked_directory(path: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| fixture_root_error())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(fixture_root_error());
    }
    path.canonicalize().map_err(|_| fixture_root_error())
}

fn identity_for(path: &Path, canonical_path: PathBuf) -> Result<PathIdentity, String> {
    let metadata = fs::metadata(path).map_err(|_| fixture_root_error())?;
    if !metadata.is_dir() {
        return Err(fixture_root_error());
    }

    Ok(identity_from_metadata(canonical_path, &metadata))
}

#[cfg(unix)]
fn identity_from_metadata(canonical_path: PathBuf, metadata: &Metadata) -> PathIdentity {
    use std::os::unix::fs::MetadataExt;
    PathIdentity {
        canonical_path,
        device: metadata.dev(),
        inode: metadata.ino(),
    }
}

#[cfg(not(unix))]
fn identity_from_metadata(canonical_path: PathBuf, _metadata: &Metadata) -> PathIdentity {
    PathIdentity { canonical_path }
}

fn revalidate_fixture_roots(
    work_root: &Path,
    expected: &ResolvedFixtureRoots,
) -> Result<(), String> {
    let current = resolve_fixture_roots(work_root)?;
    if current != *expected {
        return Err(fixture_root_error());
    }
    Ok(())
}

fn fixture_root_strings(roots: &ResolvedFixtureRoots) -> Result<[&str; 2], String> {
    Ok([
        roots.roots[0].to_str().ok_or_else(fixture_root_error)?,
        roots.roots[1].to_str().ok_or_else(fixture_root_error)?,
    ])
}

fn retain_fixture_roots(
    registry: &WorkspaceRegistry,
    resolved: &ResolvedFixtureRoots,
) -> Result<RetainedFixtureRoots, String> {
    let first = registry
        .register(&resolved.roots[0])
        .map_err(|_| fixture_root_error())?;
    let second = registry
        .register(&resolved.roots[1])
        .map_err(|_| fixture_root_error())?;
    if first.workspace_id == second.workspace_id {
        return Err(fixture_root_error());
    }

    Ok(RetainedFixtureRoots {
        workspace_ids: [first.workspace_id, second.workspace_id],
        identities: [
            resolved.guarded_paths[3].clone(),
            resolved.guarded_paths[4].clone(),
        ],
    })
}

fn verify_retained_fixture_roots(
    registry: &WorkspaceRegistry,
    retained: &RetainedFixtureRoots,
) -> Result<(), String> {
    for index in 0..retained.workspace_ids.len() {
        let root = registry
            .clone_root(&retained.workspace_ids[index])
            .map_err(|_| fixture_root_error())?;
        let metadata = root.metadata().map_err(|_| fixture_root_error())?;
        let current =
            identity_from_metadata(retained.identities[index].canonical_path.clone(), &metadata);
        if current != retained.identities[index] {
            return Err(fixture_root_error());
        }
    }
    Ok(())
}

fn fixture_config_error() -> String {
    error("Performance capture fixture trust is not configured.")
}

fn fixture_root_error() -> String {
    error("Performance capture fixture roots were rejected.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::SystemTime;

    #[test]
    fn wrong_token_is_rejected_before_fixture_resolution() {
        let config = FixtureTrustConfig {
            run_token: "a".repeat(32),
            work_root: PathBuf::from("/missing/perf-work-root"),
        };
        assert_eq!(
            authenticate(&config, "wrong-token").unwrap_err(),
            "Performance capture fixture trust was rejected."
        );
    }

    #[test]
    fn resolves_only_the_two_exact_canonical_fixture_roots() {
        let fixture = FixtureTree::new("exact-roots");
        let resolved = resolve_fixture_roots(&fixture.root).expect("resolve fixtures");

        assert_eq!(
            resolved.roots,
            [
                fixture
                    .root
                    .join("perf/fixtures/large-files")
                    .canonicalize()
                    .unwrap(),
                fixture
                    .root
                    .join("perf/fixtures/monorepo")
                    .canonicalize()
                    .unwrap(),
            ]
        );
        assert_ne!(resolved.roots[0], resolved.roots[1]);
    }

    #[test]
    fn retains_distinct_a_and_b_descriptor_bound_roots() {
        let fixture = FixtureTree::new("grant-distinct");
        let resolved = resolve_fixture_roots(&fixture.root).expect("resolve fixtures");
        let registry = WorkspaceRegistry::new();
        let retained = retain_fixture_roots(&registry, &resolved).expect("retain roots");
        verify_retained_fixture_roots(&registry, &retained).expect("verify retained roots");
        assert_ne!(retained.workspace_ids[0], retained.workspace_ids[1]);
    }

    #[test]
    fn rejects_missing_fixture_root() {
        let fixture = FixtureTree::new("missing-root");
        fs::remove_dir(fixture.root.join("perf/fixtures/monorepo")).unwrap();
        assert_eq!(
            resolve_fixture_roots(&fixture.root).unwrap_err(),
            fixture_root_error()
        );
    }

    #[test]
    fn revalidation_rejects_a_replaced_fixture_root() {
        let fixture = FixtureTree::new("replaced-root");
        let resolved = resolve_fixture_roots(&fixture.root).expect("resolve fixtures");
        let large_files = fixture.root.join("perf/fixtures/large-files");
        let displaced = fixture.root.join("perf/fixtures/displaced-large-files");
        fs::rename(&large_files, &displaced).unwrap();
        fs::create_dir(&large_files).unwrap();

        assert_eq!(
            revalidate_fixture_roots(&fixture.root, &resolved).unwrap_err(),
            fixture_root_error()
        );
    }

    #[cfg(unix)]
    #[test]
    fn replacement_between_fd_verification_and_commit_never_trusts_escape() {
        use std::os::unix::fs::symlink;

        let fixture = FixtureTree::new("commit-race");
        let outside = fixture.root.join("outside");
        fs::create_dir(&outside).unwrap();
        let storage = fixture.root.join("trust.json");
        let app = tauri::test::mock_builder()
            .manage(WorkspaceRegistry::new())
            .manage(Mutex::new(
                WorkspaceTrustService::load(storage).expect("load trust service"),
            ))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build mock app");
        let config = FixtureTrustConfig {
            run_token: "a".repeat(32),
            work_root: fixture.root.clone(),
        };
        let large_files = fixture.root.join("perf/fixtures/large-files");
        let displaced = fixture.root.join("perf/fixtures/displaced-large-files");

        trust_fixture_workspaces_blocking_with_hook(&app.handle().clone(), &config, || {
            fs::rename(&large_files, &displaced).unwrap();
            symlink(&outside, &large_files).unwrap();
        })
        .expect("grant retained fixture identities");

        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        let trust = trust.lock().expect("lock trust");
        assert!(!trust.get(outside.to_str().unwrap()).trusted);
        drop(trust);
        fs::remove_file(&large_files).unwrap();
        fs::rename(&displaced, &large_files).unwrap();
        let trust = app.state::<Mutex<WorkspaceTrustService>>();
        assert!(
            trust
                .lock()
                .expect("lock trust")
                .get(large_files.to_str().unwrap())
                .trusted
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_fixture_root_and_path_escape() {
        use std::os::unix::fs::symlink;

        let fixture = FixtureTree::new("symlink-root");
        let outside = fixture.root.join("outside");
        fs::create_dir(&outside).unwrap();
        fs::remove_dir(fixture.root.join("perf/fixtures/large-files")).unwrap();
        symlink(&outside, fixture.root.join("perf/fixtures/large-files")).unwrap();

        assert_eq!(
            resolve_fixture_roots(&fixture.root).unwrap_err(),
            fixture_root_error()
        );
    }

    struct FixtureTree {
        root: PathBuf,
    }

    impl FixtureTree {
        fn new(prefix: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            let root = std::env::temp_dir().join(format!("perf-fixture-trust-{prefix}-{nanos}"));
            fs::create_dir_all(root.join("perf/fixtures/large-files")).unwrap();
            fs::create_dir_all(root.join("perf/fixtures/monorepo")).unwrap();
            Self { root }
        }
    }

    impl Drop for FixtureTree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
