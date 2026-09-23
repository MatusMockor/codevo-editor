use super::{
    git_process, snapshot,
    types::{RootIdentity, UnsupportedReason},
};
use std::{fs::File, ops::Deref, path::Path, process::Command};

/// Keeps repository discovery separate from checkpoint writes. Every command
/// uses the captured repository, rather than rediscovering a mutable `.git`.
pub(super) struct Context {
    root: RootIdentity,
    _root_handle: File,
    git: RootIdentity,
    _git_handle: File,
    common: RootIdentity,
    common_handle: File,
}

impl Deref for Context {
    type Target = RootIdentity;

    fn deref(&self) -> &RootIdentity {
        &self.root
    }
}

impl Context {
    pub(super) fn new(identity: &RootIdentity) -> Result<Self, String> {
        snapshot::verify_root(identity)?;
        let (root_handle, root) = snapshot::root_identity(Path::new(&identity.path))?;
        if &root != identity {
            return Err("The workspace changed before checkpoint capture.".into());
        }
        let discover = |option: &str| -> Result<String, String> {
            let mut command = git_process::git_command();
            command
                .current_dir(&root.path)
                .args(["rev-parse", "--path-format=absolute", option]);
            output_path(git_process::run(command, false)?)
        };
        let top = discover("--show-toplevel")?;
        let (_, top_identity) = snapshot::root_identity(Path::new(&top))?;
        if top_identity != root {
            return Err("Checkpoint workspace must be the Git working tree root.".into());
        }
        let (git_handle, git) =
            snapshot::root_identity(Path::new(&discover("--absolute-git-dir")?))?;
        let (common_handle, common) =
            snapshot::root_identity(Path::new(&discover("--git-common-dir")?))?;
        let context = Self {
            root,
            _root_handle: root_handle,
            git,
            _git_handle: git_handle,
            common,
            common_handle,
        };
        context.verify()?;
        Ok(context)
    }

    pub(super) fn git_identity(&self) -> RootIdentity {
        self.git.clone()
    }

    pub(super) fn common_identity(&self) -> RootIdentity {
        self.common.clone()
    }

    #[cfg(unix)]
    pub(super) fn command(&self) -> Result<Command, String> {
        use std::os::{fd::AsRawFd, unix::process::CommandExt};
        self.verify()?;
        let directory = self
            .common_handle
            .try_clone()
            .map_err(|_| "Could not retain checkpoint repository authority.")?;
        let mut command = git_process::git_command();
        command
            .arg("--git-dir=.")
            .arg("--work-tree=.")
            .env("GIT_NO_REPLACE_OBJECTS", "1")
            .env("GIT_COMMON_DIR", ".");
        // Only object/index/ref operations use this context. Their temporary
        // index and namespaced refs never need the real worktree or HEAD. Use
        // the pinned common repository even for linked worktrees, so neither
        // a swapped common-dir pathname nor a rewritten commondir can redirect
        // writes. Setting the worktree to the pinned cwd prevents Git changing
        // directory and reinterpreting the relative common-dir authority.
        // The closure owns the descriptor until spawn completes. fchdir is
        // async-signal-safe and never follows a replacement `.git` pathname.
        unsafe {
            command.pre_exec(move || {
                if libc::fchdir(directory.as_raw_fd()) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
        Ok(command)
    }

    #[cfg(not(unix))]
    pub(super) fn command(&self) -> Result<Command, String> {
        Err("Git checkpoints are unavailable on this platform.".into())
    }

    /// Check that the workspace still discovers the captured repository. Keeping
    /// its directories alive alone does not detect a rewritten worktree `.git` file.
    pub(super) fn verify_binding(&self) -> Result<(), String> {
        self.verify()?;
        let current = Self::new(&self.root)?;
        if current.git != self.git || current.common != self.common {
            return Err("The workspace Git repository changed while recording changes.".into());
        }
        Ok(())
    }

    pub(super) fn verify(&self) -> Result<(), String> {
        snapshot::verify_root(&self.root)?;
        snapshot::verify_root(&self.git)?;
        snapshot::verify_root(&self.common)
    }
}

pub(super) fn unsupported_reason(
    identity: &RootIdentity,
) -> Result<Option<UnsupportedReason>, String> {
    snapshot::verify_root(identity)?;
    let root = Path::new(&identity.path);
    let mut command = git_process::git_command();
    command
        .current_dir(root)
        .args(["rev-parse", "--path-format=absolute", "--show-toplevel"]);
    let top = match git_process::discover(command) {
        Ok(bytes) => output_path(bytes)?,
        Err(git_process::Failure::NotRepository) => {
            return Ok(Some(UnsupportedReason::NotGitRepository))
        }
        Err(git_process::Failure::Other(reason)) => return Err(reason),
    };
    let (_, top_identity) = snapshot::root_identity(Path::new(&top))?;
    snapshot::verify_root(identity)?;
    if &top_identity != identity {
        return Ok(Some(UnsupportedReason::NotWorktreeRoot));
    }
    Ok(None)
}

fn output_path(bytes: Vec<u8>) -> Result<String, String> {
    let path = std::str::from_utf8(&bytes)
        .map_err(|_| "Git checkpoint paths must be UTF-8.")?
        .strip_suffix('\n')
        .ok_or("Invalid Git checkpoint path.")?;
    if path.is_empty()
        || path.len() > 4096
        || path.chars().any(char::is_control)
        || !Path::new(path).is_absolute()
    {
        return Err("Invalid Git checkpoint path.".into());
    }
    Ok(path.to_owned())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::SystemTime,
    };

    static NEXT: AtomicU64 = AtomicU64::new(0);

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "checkpoint-authority-{}-{nonce}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn git(root: &Path, args: &[&str]) {
        let mut command = git_process::git_command();
        command.current_dir(root).args(args);
        git_process::run(command, false).unwrap();
    }

    #[test]
    fn rejects_nested_workspace_repository_discovery() {
        let temp = Temp::new();
        git(&temp.0, &["init", "--quiet"]);
        let nested = temp.0.join("nested");
        fs::create_dir(&nested).unwrap();
        let (_, root) = snapshot::root_identity(&nested).unwrap();
        assert!(Context::new(&root).is_err());
    }

    #[test]
    fn prepared_command_cannot_write_into_replacement_git_directory() {
        let temp = Temp::new();
        git(&temp.0, &["init", "--quiet"]);
        let (_, root) = snapshot::root_identity(&temp.0).unwrap();
        let context = Context::new(&root).unwrap();
        let mut command = context.command().unwrap();
        command.args(["hash-object", "-w", "--stdin"]);
        fs::write(temp.0.join("input"), "checkpoint data").unwrap();
        fs::rename(temp.0.join(".git"), temp.0.join("captured-git")).unwrap();
        git(&temp.0, &["init", "--quiet"]);
        let bytes =
            git_process::run_input(command, File::open(temp.0.join("input")).unwrap()).unwrap();
        let oid = std::str::from_utf8(&bytes).unwrap().trim();
        let object = format!("objects/{}/{}", &oid[..2], &oid[2..]);
        assert!(temp.0.join("captured-git").join(&object).exists());
        assert!(!temp.0.join(".git").join(&object).exists());
        assert!(context.verify().is_err());
    }

    #[test]
    fn immutable_object_reads_ignore_repository_replacements() {
        let temp = Temp::new();
        git(&temp.0, &["init", "--quiet"]);
        let mut objects = Vec::new();
        for content in ["original", "replacement"] {
            fs::write(temp.0.join("input"), content).unwrap();
            let mut command = git_process::git_command();
            command
                .current_dir(&temp.0)
                .args(["hash-object", "-w", "input"]);
            objects.push(
                String::from_utf8(git_process::run(command, false).unwrap())
                    .unwrap()
                    .trim()
                    .to_string(),
            );
        }
        git(&temp.0, &["replace", &objects[0], &objects[1]]);
        let (_, root) = snapshot::root_identity(&temp.0).unwrap();
        let context = Context::new(&root).unwrap();
        let mut command = context.command().unwrap();
        command.args(["cat-file", "blob", &objects[0]]);
        assert_eq!(git_process::run(command, false).unwrap(), b"original");
    }

    #[test]
    fn retains_linked_worktree_repository_and_common_directory() {
        let temp = Temp::new();
        let main = temp.0.join("main");
        let linked = temp.0.join("linked");
        fs::create_dir(&main).unwrap();
        git(&main, &["init", "--quiet"]);
        git(
            &main,
            &[
                "-c",
                "user.name=Checkpoint test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--quiet",
                "--allow-empty",
                "-m",
                "initial",
            ],
        );
        git(
            &main,
            &[
                "worktree",
                "add",
                "--quiet",
                "--detach",
                linked.to_str().unwrap(),
            ],
        );
        let (_, root) = snapshot::root_identity(&linked).unwrap();
        let context = Context::new(&root).unwrap();
        assert_ne!(context.git_identity(), context.common_identity());
        fs::write(linked.join("input"), "linked checkpoint").unwrap();
        let mut command = context.command().unwrap();
        command.args(["hash-object", "-w", "--stdin"]);
        context.verify().unwrap();
        fs::rename(main.join(".git"), main.join("captured-git")).unwrap();
        git(&main, &["init", "--quiet"]);
        let bytes =
            git_process::run_input(command, File::open(linked.join("input")).unwrap()).unwrap();
        let oid = std::str::from_utf8(&bytes).unwrap().trim();
        assert!(main
            .join("captured-git/objects")
            .join(&oid[..2])
            .join(&oid[2..])
            .exists());
        assert!(!main
            .join(".git/objects")
            .join(&oid[..2])
            .join(&oid[2..])
            .exists());
        assert!(context.verify().is_err());
    }

    #[test]
    fn rewritten_git_pointer_is_rejected_even_when_original_directories_remain() {
        let temp = Temp::new();
        let workspace = temp.0.join("workspace");
        let captured = temp.0.join("captured-git");
        let foreign = temp.0.join("foreign");
        fs::create_dir(&workspace).unwrap();
        fs::create_dir(&foreign).unwrap();
        git(
            &workspace,
            &[
                "init",
                "--quiet",
                "--separate-git-dir",
                captured.to_str().unwrap(),
            ],
        );
        git(&foreign, &["init", "--quiet"]);
        fs::write(workspace.join("tracked"), "owned workspace contents").unwrap();
        git(&workspace, &["add", "tracked"]);
        fs::write(workspace.join(".gitignore"), "tracked\n").unwrap();
        let (_, root) = snapshot::root_identity(&workspace).unwrap();
        let context = Context::new(&root).unwrap();
        context.verify_binding().unwrap();
        assert!(git_process::inventory(&workspace)
            .unwrap()
            .contains(&"tracked".into()));
        fs::write(
            workspace.join(".git"),
            format!("gitdir: {}\n", foreign.join(".git").display()),
        )
        .unwrap();
        // Every original directory still exists, but foreign inventory silently
        // omits the tracked-and-now-ignored path. Binding verification catches it.
        context.verify().unwrap();
        assert!(!git_process::inventory(&workspace)
            .unwrap()
            .contains(&"tracked".into()));
        assert!(context.verify_binding().is_err());
    }
}
