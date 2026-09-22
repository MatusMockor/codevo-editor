use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};
use std::process::Command;
use std::time::{Duration, Instant};

use crate::repository_process_support::pipes::{read_streams, StreamLimits, StreamsResult};
use crate::repository_process_support::process_guard::{
    await_exit_without_reaping, ChildGuard, Watchdog,
};

const MAX_FILES: usize = 10_000;
const MAX_PATH_BYTES: usize = 4096;
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn inventory(root: &Path) -> Result<Vec<String>, String> {
    let mut command = git_command();
    command.current_dir(root).args([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
    ]);
    let bytes = run(command, false)?;
    let mut paths = BTreeSet::new();
    for path in nul_records(&bytes)? {
        let path = relative_path(path)?;
        paths.insert(path);
        if paths.len() > MAX_FILES {
            return Err("Too many files to capture turn changes.".into());
        }
    }
    Ok(paths.into_iter().collect())
}

pub(super) fn numstat(before: &Path, after: &Path) -> Result<BTreeMap<String, (u64, u64)>, String> {
    if !before.is_absolute() || !after.is_absolute() || before == after {
        return Err("Turn snapshots must be distinct absolute paths.".into());
    }
    let mut command = git_command();
    command
        .current_dir(before)
        .args([
            "diff",
            "--no-index",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--numstat",
            "-z",
            "--",
        ])
        .arg(before)
        .arg(after);
    parse_numstat(&run(command, true)?, before, after)
}

fn git_command() -> Command {
    let mut command = Command::new("git");
    // Do not inherit alternate indexes, injected config, external diff helpers,
    // or repository/worktree redirection from the launching environment.
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("GIT_") {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .env("LANG", "C");
    for config in [
        "core.fsmonitor=false",
        "core.hooksPath=/dev/null",
        "diff.external=",
        "core.attributesFile=/dev/null",
    ] {
        command.arg("-c").arg(config);
    }
    command
}

fn run(command: Command, diff: bool) -> Result<Vec<u8>, String> {
    let mut guard =
        ChildGuard::spawn(command).map_err(|_| "Could not start snapshot Git command.")?;
    let deadline = Instant::now() + TIMEOUT;
    let (stdout, stderr) = guard
        .take_streams()
        .ok_or("Could not capture snapshot Git output.")?;
    let watchdog = Watchdog::start(guard.process_id(), TIMEOUT)
        .map_err(|_| "Could not start snapshot Git timeout.")?;
    let streams = read_streams(
        stdout,
        stderr,
        StreamLimits {
            stdout_bytes: MAX_OUTPUT_BYTES,
            stderr_bytes: 8192,
        },
        deadline,
    );
    if !matches!(streams, StreamsResult::Complete { .. }) {
        guard.kill();
    }
    let exited = await_exit_without_reaping(guard.process_id());
    let expired = watchdog.finish();
    // Kill the owned group before reaping even on success: no descendant may
    // survive this operation, and the unreaped leader prevents PID reuse.
    guard.kill();
    let status = guard
        .wait()
        .map_err(|_| "Could not reap snapshot Git command.")?;
    if expired || matches!(streams, StreamsResult::TimedOut) {
        return Err("Snapshot Git command timed out.".into());
    }
    if !exited || !(status.success() || diff && status.code() == Some(1)) {
        return Err("Snapshot Git command failed.".into());
    }
    match streams {
        StreamsResult::Complete { stdout, .. } => Ok(stdout),
        StreamsResult::TooLarge => Err("Snapshot Git output exceeded its limit.".into()),
        _ => Err("Could not read snapshot Git output.".into()),
    }
}

fn nul_records(bytes: &[u8]) -> Result<Vec<&str>, String> {
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    if bytes.len() > MAX_OUTPUT_BYTES || bytes.last() != Some(&0) {
        return Err("Invalid snapshot Git output.".into());
    }
    std::str::from_utf8(&bytes[..bytes.len() - 1])
        .map(|text| text.split('\0').collect())
        .map_err(|_| "Snapshot paths must be UTF-8.".into())
}

fn relative_path(path: &str) -> Result<String, String> {
    if path.is_empty()
        || path.len() > MAX_PATH_BYTES
        || path.contains('\\')
        || !Path::new(path)
            .components()
            .all(|part| matches!(part, Component::Normal(_)))
    {
        return Err("Invalid snapshot relative path.".into());
    }
    Ok(path.to_string())
}

fn snapshot_path(path: &str, root: &Path) -> Result<Option<String>, String> {
    if path == "/dev/null" {
        return Ok(None);
    }
    let relative = Path::new(path)
        .strip_prefix(root)
        .map_err(|_| "Git returned a path outside the turn snapshot.")?
        .to_str()
        .ok_or("Snapshot paths must be UTF-8.")?;
    relative_path(relative).map(Some)
}

fn parse_numstat(
    bytes: &[u8],
    before: &Path,
    after: &Path,
) -> Result<BTreeMap<String, (u64, u64)>, String> {
    let records = nul_records(bytes)?;
    let mut records = records.into_iter();
    let mut result = BTreeMap::new();
    while let Some(header) = records.next() {
        let mut fields = header.splitn(3, '\t');
        let added = fields.next().ok_or("Missing snapshot additions.")?;
        let removed = fields.next().ok_or("Missing snapshot deletions.")?;
        if fields.next() != Some("") {
            return Err("Invalid snapshot diff record.".into());
        }
        let old = snapshot_path(records.next().ok_or("Missing before path.")?, before)?;
        let new = snapshot_path(records.next().ok_or("Missing after path.")?, after)?;
        let path = match (old, new) {
            (Some(old), Some(new)) if old == new => old,
            (Some(path), None) | (None, Some(path)) => path,
            _ => return Err("Invalid snapshot path pairing.".into()),
        };
        let counts = if added == "-" && removed == "-" {
            (0, 0)
        } else {
            (
                added
                    .parse::<u64>()
                    .map_err(|_| "Invalid addition count.")?,
                removed
                    .parse::<u64>()
                    .map_err(|_| "Invalid deletion count.")?,
            )
        };
        if result.insert(path, counts).is_some() || result.len() > MAX_FILES {
            return Err("Invalid or excessive snapshot diff entries.".into());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_git_compares_trees_without_touching_repository_index() {
        struct Temp(std::path::PathBuf);
        impl Drop for Temp {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let temp =
            Temp(std::env::temp_dir().join(format!("turn-diff-{}-{unique}", std::process::id())));
        let before = temp.0.join("before");
        let after = temp.0.join("after");
        std::fs::create_dir_all(&before).unwrap();
        std::fs::create_dir_all(&after).unwrap();
        std::fs::write(before.join("changed"), "old\n").unwrap();
        std::fs::write(after.join("changed"), "new\nextra\n").unwrap();
        std::fs::write(before.join("deleted"), "gone\n").unwrap();
        std::fs::write(after.join("added"), "new\n").unwrap();
        let stats = numstat(&before, &after).unwrap();
        assert_eq!(stats["changed"], (2, 1));
        assert_eq!(stats["deleted"], (0, 1));
        assert_eq!(stats["added"], (1, 0));
        let mut init = git_command();
        init.current_dir(&after).args(["init", "--quiet"]);
        run(init, false).unwrap();
        std::fs::write(after.join(".gitignore"), "ignored\n").unwrap();
        std::fs::write(after.join("ignored"), "secret\n").unwrap();
        let files = inventory(&after).unwrap();
        assert_eq!(files, vec![".gitignore", "added", "changed"]);
        assert!(!after.join(".git/index").exists());
    }

    #[test]
    fn parses_directory_changes_and_binary_paths() {
        let bytes = b"1\t0\t\0/dev/null\0/after/add\0\
            0\t2\t\0/before/deleted\0/dev/null\0\
            2\t3\t\0/before/tab\tname\0/after/tab\tname\0\
            -\t-\t\0/before/binary\0/after/binary\0";
        let result = parse_numstat(bytes, Path::new("/before"), Path::new("/after")).unwrap();
        assert_eq!(result["add"], (1, 0));
        assert_eq!(result["deleted"], (0, 2));
        assert_eq!(result["tab\tname"], (2, 3));
        assert_eq!(result["binary"], (0, 0));
    }

    #[test]
    fn rejects_foreign_traversal_and_unterminated_records() {
        for bytes in [
            &b"1\t1\t\0/foreign/x\0/after/x\0"[..],
            &b"1\t1\t\0/before/../x\0/after/x\0"[..],
            &b"1\t1\t\0/before/x\0/after/x"[..],
            &b"1\t1\t\0/before/x\0/after/y\0"[..],
        ] {
            assert!(parse_numstat(bytes, Path::new("/before"), Path::new("/after")).is_err());
        }
    }
}
