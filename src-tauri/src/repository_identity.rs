//! Sanitized origin identity for display grouping. Never an execution authority.
use crate::git::bounded_process::run_bounded_command_bytes;
use crate::workspace_registry::WorkspaceRegistry;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tauri::Manager;

static ACTIVE: AtomicUsize = AtomicUsize::new(0);
struct Permit;
impl Drop for Permit {
    fn drop(&mut self) {
        ACTIVE.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) fn canonical_identity(raw: &str) -> Option<String> {
    if raw.is_empty()
        || raw.len() > 2048
        || !raw.bytes().all(|c| (33..127).contains(&c))
        || raw.contains(['?', '#', '\\'])
    {
        return None;
    }
    let (scheme, authority, path) = if let Some((scheme, rest)) = raw.split_once("://") {
        if !["https", "http", "ssh", "git"].contains(&scheme) {
            return None;
        }
        let (authority, path) = rest.split_once('/')?;
        (scheme, authority, path)
    } else {
        let (authority, path) = raw.split_once(':')?;
        if authority.contains('/') {
            return None;
        }
        ("ssh", authority, path)
    };
    let authority = authority.rsplit('@').next()?.to_ascii_lowercase();
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => {
            if port.is_empty() || port.len() > 5 || !port.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            (host, Some(port.parse::<u16>().ok()?))
        }
        None => (authority.as_str(), None),
    };
    if !host.contains('.')
        || host.contains("..")
        || !host.as_bytes().first()?.is_ascii_alphanumeric()
        || !host.as_bytes().last()?.is_ascii_alphanumeric()
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
        || port == Some(0)
    {
        return None;
    }
    let default_port = match scheme {
        "https" => 443,
        "http" => 80,
        "git" => 9418,
        _ => 22,
    };
    let path = path.trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    if !path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"_.~/-".contains(&b))
        || path
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return None;
    }
    let path = if host == "github.com" {
        path.to_ascii_lowercase()
    } else {
        path.to_string()
    };
    let port = port
        .filter(|p| *p != default_port)
        .map(|p| format!(":{p}"))
        .unwrap_or_default();
    Some(format!("{host}{port}/{path}"))
}

fn discover_origin(root: &std::fs::File) -> Option<String> {
    let mut command = Command::new("git");
    command.env_clear();
    if let Some(path) = std::env::var_os("PATH") {
        command.env("PATH", path);
    }
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_OPTIONAL_LOCKS", "0");
    command.args([
        "config",
        "--local",
        "--no-includes",
        "--get",
        "remote.origin.url",
    ]);
    #[cfg(unix)]
    {
        use std::os::fd::AsRawFd;
        use std::os::unix::process::CommandExt;
        let fd = root.as_raw_fd();
        // The retained descriptor pins the working directory through replacement.
        unsafe {
            command.pre_exec(move || {
                if libc::fchdir(fd) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }
    #[cfg(not(unix))]
    command.current_dir(crate::workspace_registry::opened_root_path(root).ok()?);
    run_bounded_command_bytes(command, Duration::from_secs(3), 2049)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|raw| canonical_identity(raw.trim_end_matches(['\n', '\r'])))
}

#[tauri::command]
pub(crate) async fn get_repository_identity(
    root_path: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    if root_path.is_empty() || root_path.len() > 4096 || root_path.contains('\0') {
        return Err("Invalid project path.".into());
    }
    let registry = app.state::<WorkspaceRegistry>();
    let descriptor = registry
        .descriptor_for_registered_path(Path::new(&root_path))
        .map_err(|_| "Project is not registered.")?;
    let root = registry
        .clone_root(&descriptor.workspace_id)
        .map_err(|_| "Project is unavailable.")?;
    if ACTIVE
        .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
            (n < 4).then_some(n + 1)
        })
        .is_err()
    {
        return Err("Repository discovery is busy.".into());
    }
    let permit = Permit;
    crate::run_blocking_command(move || {
        let _permit = permit;
        let result = discover_origin(&root);
        let current = app
            .state::<WorkspaceRegistry>()
            .descriptor_for_registered_path(Path::new(&root_path))
            .map_err(|_| "Project is no longer registered.")?;
        if current != descriptor {
            return Err("Project changed during discovery.".into());
        }
        drop(root);
        Ok(result)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_origin_for_root_and_worktree_without_includes() {
        struct Temp(std::path::PathBuf);
        impl Temp {
            fn path(&self) -> &Path {
                &self.0
            }
        }
        impl Drop for Temp {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let temp = Temp(std::env::temp_dir().join(format!(
                "codevo-repository-identity-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            )));
        std::fs::create_dir(&temp.0).unwrap();
        let run = |args: &[&str]| {
            assert!(Command::new("git")
                .current_dir(temp.path())
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        };
        run(&["init"]);
        run(&[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "--allow-empty",
            "-m",
            "init",
        ]);
        run(&[
            "config",
            "remote.origin.url",
            "https://secret:password@github.com/Org/Repo.git",
        ]);
        run(&["worktree", "add", "--detach", "linked"]);
        for path in [temp.path().to_path_buf(), temp.path().join("linked")] {
            assert_eq!(
                discover_origin(&std::fs::File::open(path).unwrap()).as_deref(),
                Some("github.com/org/repo")
            );
        }
        run(&["config", "--unset", "remote.origin.url"]);
        let external = temp.path().join("external-config");
        std::fs::write(
            &external,
            "[remote \"origin\"]\nurl = https://github.com/foreign/repo\n",
        )
        .unwrap();
        run(&["config", "include.path", external.to_str().unwrap()]);
        assert_eq!(
            discover_origin(&std::fs::File::open(temp.path()).unwrap()),
            None
        );
    }
    #[test]
    fn credentials_and_transports_share_identity() {
        for url in [
            "git@github.com:Org/Repo.git",
            "https://secret:password@GitHub.com/Org/Repo.git/",
            "ssh://git@github.com:22/Org/Repo",
        ] {
            assert_eq!(
                canonical_identity(url).as_deref(),
                Some("github.com/org/repo")
            );
        }
        assert_eq!(
            canonical_identity("ssh://git@git.example.com:2222/Team/Repo.git").as_deref(),
            Some("git.example.com:2222/Team/Repo")
        );
    }
    #[test]
    fn rejects_unsafe_and_ambiguous_remotes() {
        for url in [
            "/tmp/repo",
            "file:///tmp/repo",
            "https://git.example.com/a/../b",
            "https://git.example.com/a?secret=x",
            "https://git.example.com/a#token",
            "https://git.example.com//a",
            "https://git.example.com:0/a",
            "https://git.example.com/a%2fb",
            "https://git.example.com/a\nb",
            "x:repo",
        ] {
            assert!(canonical_identity(url).is_none(), "{url}");
        }
        assert!(canonical_identity(&"x".repeat(2049)).is_none());
    }
}
