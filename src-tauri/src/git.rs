use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub branch: Option<String>,
    pub changes: Vec<GitChangedFile>,
    pub is_repository: bool,
    pub root_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedFile {
    pub is_staged: bool,
    pub is_unversioned: bool,
    pub old_path: Option<String>,
    pub old_relative_path: Option<String>,
    pub path: String,
    pub relative_path: String,
    pub status: GitChangeStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitChangeStatus {
    Added,
    Conflicted,
    Deleted,
    Modified,
    Renamed,
    Untracked,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileDiff {
    pub change: GitChangedFile,
    pub language: String,
    pub modified_content: String,
    pub original_content: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBlameLine {
    pub author: String,
    pub line_number: u32,
    pub sha: String,
    pub timestamp: i64,
}

pub trait GitRepositoryGateway {
    fn blame(&self, root: &Path, relative_path: &str) -> io::Result<Vec<GitBlameLine>>;
    fn commit(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus>;
    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff>;
    fn push(&self, root: &Path) -> io::Result<GitStatus>;
    fn revert(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
    fn stage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
    fn status(&self, root: &Path) -> io::Result<GitStatus>;
    fn unstage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus>;
}

pub struct CommandGitRepositoryGateway;

impl GitRepositoryGateway for CommandGitRepositoryGateway {
    fn blame(&self, root: &Path, relative_path: &str) -> io::Result<Vec<GitBlameLine>> {
        let root = root.canonicalize()?;
        let relative = safe_relative_path(relative_path)?;
        let relative = relative.to_string_lossy().to_string();

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("blame")
            .arg("--porcelain")
            .arg("--")
            .arg(&relative)
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).trim().to_string(),
            ));
        }

        parse_blame_porcelain(&output.stdout)
    }

    fn commit(
        &self,
        root: &Path,
        message: &str,
        changes: &[GitChangedFile],
    ) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;
        let message = message.trim();

        if message.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Commit message is required.",
            ));
        }

        if changes.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "At least one file is required for commit.",
            ));
        }

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            if let Some(old_relative_path) = change.old_relative_path.as_deref() {
                safe_relative_path(old_relative_path)?;
            }
        }

        commit_selected_staged_changes(&root, message, changes)?;
        self.status(&root)
    }

    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff> {
        let root = root.canonicalize()?;
        let original_content = original_content(&root, change)?;
        let modified_content = modified_content(&root, change)?;

        Ok(GitFileDiff {
            change: change.clone(),
            language: language_for_path(&change.relative_path),
            modified_content,
            original_content,
        })
    }

    fn push(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        run_git(&root, ["push"])?;
        self.status(&root)
    }

    fn revert(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;

            if change.status == GitChangeStatus::Untracked {
                run_git(&root, ["clean", "-f", "--", change.relative_path.as_str()])?;
            } else if change.status == GitChangeStatus::Added && change.is_staged {
                run_git(
                    &root,
                    ["restore", "--staged", "--", change.relative_path.as_str()],
                )?;
                run_git(&root, ["clean", "-f", "--", change.relative_path.as_str()])?;
            } else {
                if change.is_staged {
                    run_git(
                        &root,
                        ["restore", "--staged", "--", change.relative_path.as_str()],
                    )?;
                }

                run_git(&root, ["restore", "--", change.relative_path.as_str()])?;
            }
        }

        self.status(&root)
    }

    fn stage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            run_git(&root, ["add", "--", change.relative_path.as_str()])?;
        }

        self.status(&root)
    }

    fn status(&self, root: &Path) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        if !is_git_repository(&root)? {
            return Ok(empty_git_status(&root));
        }

        let output = Command::new("git")
            .arg("-C")
            .arg(&root)
            .arg("status")
            .arg("--porcelain=v1")
            .arg("-z")
            .arg("--untracked-files=normal")
            .output()?;

        if !output.status.success() {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        Ok(GitStatus {
            branch: current_branch(&root).ok().flatten(),
            changes: parse_porcelain_status(&root, &output.stdout)?,
            is_repository: true,
            root_path: root.to_string_lossy().to_string(),
        })
    }

    fn unstage(&self, root: &Path, changes: &[GitChangedFile]) -> io::Result<GitStatus> {
        let root = root.canonicalize()?;

        for change in changes {
            safe_relative_path(&change.relative_path)?;
            run_git(
                &root,
                ["restore", "--staged", "--", change.relative_path.as_str()],
            )?;
        }

        self.status(&root)
    }
}

pub fn empty_git_status(root: &Path) -> GitStatus {
    GitStatus {
        branch: None,
        changes: Vec::new(),
        is_repository: false,
        root_path: root.to_string_lossy().to_string(),
    }
}

fn is_git_repository(root: &Path) -> io::Result<bool> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()?;

    if !output.status.success() {
        return Ok(false);
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim() == "true")
}

fn current_branch(root: &Path) -> io::Result<Option<String>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("branch")
        .arg("--show-current")
        .output()?;

    if !output.status.success() {
        return Ok(None);
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if branch.is_empty() {
        return Ok(None);
    }

    Ok(Some(branch))
}

fn parse_porcelain_status(root: &Path, output: &[u8]) -> io::Result<Vec<GitChangedFile>> {
    let parts: Vec<&[u8]> = output
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .collect();
    let mut changes = Vec::new();
    let mut index = 0usize;

    while index < parts.len() {
        let entry = String::from_utf8_lossy(parts[index]).to_string();
        index += 1;

        if entry.len() < 4 {
            continue;
        }

        let status_code = &entry[..2];
        let relative_path = entry[3..].to_string();
        let status = git_change_status(status_code);
        let is_staged = git_change_is_staged(status_code);
        let is_unversioned = status == GitChangeStatus::Untracked;
        let old_relative_path = match status {
            GitChangeStatus::Renamed => {
                let old = parts
                    .get(index)
                    .map(|part| String::from_utf8_lossy(part).to_string());

                if old.is_some() {
                    index += 1;
                }

                old
            }
            _ => None,
        };

        let path = workspace_file_path(root, &relative_path)?;
        let old_path = match old_relative_path.as_deref() {
            Some(path) => Some(workspace_file_path(root, path)?),
            None => None,
        };

        changes.push(GitChangedFile {
            is_staged,
            is_unversioned,
            old_path,
            old_relative_path,
            path,
            relative_path,
            status,
        });
    }

    Ok(changes)
}

struct BlameCommitMeta {
    author: String,
    timestamp: i64,
}

impl BlameCommitMeta {
    fn empty() -> Self {
        Self {
            author: String::new(),
            timestamp: 0,
        }
    }
}

fn parse_blame_porcelain(output: &[u8]) -> io::Result<Vec<GitBlameLine>> {
    let text = String::from_utf8_lossy(output);
    let mut commits: std::collections::HashMap<String, BlameCommitMeta> =
        std::collections::HashMap::new();
    let mut lines = Vec::new();
    let mut current: Option<(String, u32)> = None;

    for line in text.lines() {
        // The single `\t`-prefixed line per group is the source line; it closes
        // the in-flight group, resolving its metadata from the per-SHA cache.
        if line.starts_with('\t') {
            if let Some((sha, final_line)) = current.take() {
                lines.push(blame_line_from(&commits, &sha, final_line));
            }
            continue;
        }

        if let Some((sha, final_line)) = parse_blame_header(line) {
            commits.entry(sha.clone()).or_insert_with(BlameCommitMeta::empty);
            current = Some((sha, final_line));
            continue;
        }

        // Metadata line (author/author-time/...) for the in-flight commit.
        if let Some((sha, _)) = current.as_ref() {
            apply_blame_commit_meta(&mut commits, sha, line);
        }
    }

    // Surface a final group whose closing content line was missing (truncated
    // porcelain) so the line we already identified is not silently dropped.
    if let Some((sha, final_line)) = current.take() {
        lines.push(blame_line_from(&commits, &sha, final_line));
    }

    Ok(lines)
}

fn blame_line_from(
    commits: &std::collections::HashMap<String, BlameCommitMeta>,
    sha: &str,
    final_line: u32,
) -> GitBlameLine {
    let meta = commits.get(sha);

    GitBlameLine {
        author: meta.map(|meta| meta.author.clone()).unwrap_or_default(),
        line_number: final_line,
        sha: short_sha(sha),
        timestamp: meta.map(|meta| meta.timestamp).unwrap_or_default(),
    }
}

fn parse_blame_header(line: &str) -> Option<(String, u32)> {
    let mut parts = line.split(' ');
    let sha = parts.next()?;

    if sha.len() != 40 || !sha.chars().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }

    let _original_line = parts.next()?;
    let final_line = parts.next()?.parse::<u32>().ok()?;

    Some((sha.to_string(), final_line))
}

fn apply_blame_commit_meta(
    commits: &mut std::collections::HashMap<String, BlameCommitMeta>,
    sha: &str,
    line: &str,
) {
    let Some(meta) = commits.get_mut(sha) else {
        return;
    };

    if let Some(author) = line.strip_prefix("author ") {
        meta.author = author.to_string();
        return;
    }

    if let Some(timestamp) = line.strip_prefix("author-time ") {
        meta.timestamp = timestamp.trim().parse::<i64>().unwrap_or_default();
    }
}

fn short_sha(sha: &str) -> String {
    sha.chars().take(7).collect()
}

fn git_change_is_staged(status: &str) -> bool {
    status
        .chars()
        .next()
        .is_some_and(|value| value != ' ' && value != '?')
}

fn git_change_status(status: &str) -> GitChangeStatus {
    if status == "??" {
        return GitChangeStatus::Untracked;
    }

    if status.contains('U') || matches!(status, "AA" | "DD") {
        return GitChangeStatus::Conflicted;
    }

    if status.contains('R') {
        return GitChangeStatus::Renamed;
    }

    if status.contains('D') {
        return GitChangeStatus::Deleted;
    }

    if status.contains('A') {
        return GitChangeStatus::Added;
    }

    GitChangeStatus::Modified
}

fn run_git<const N: usize>(root: &Path, args: [&str; N]) -> io::Result<()> {
    run_git_vec(root, args.to_vec())
}

fn run_git_vec(root: &Path, args: Vec<&str>) -> io::Result<()> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()?;

    if output.status.success() {
        return Ok(());
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn git_output_vec(root: &Path, args: Vec<&str>) -> io::Result<String> {
    git_output_vec_with_env(root, args, None)
}

fn git_output_vec_with_env(
    root: &Path,
    args: Vec<&str>,
    index_file: Option<&Path>,
) -> io::Result<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);

    if let Some(index_file) = index_file {
        command.env("GIT_INDEX_FILE", index_file);
    }

    let output = command.output()?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    Err(io::Error::new(
        io::ErrorKind::Other,
        String::from_utf8_lossy(&output.stderr).trim().to_string(),
    ))
}

fn run_git_vec_with_env(root: &Path, args: Vec<&str>, index_file: Option<&Path>) -> io::Result<()> {
    git_output_vec_with_env(root, args, index_file).map(|_| ())
}

fn commit_selected_staged_changes(
    root: &Path,
    message: &str,
    changes: &[GitChangedFile],
) -> io::Result<()> {
    let temp_index = TempGitIndex::new(root);
    let has_head = git_output_vec(root, vec!["rev-parse", "--verify", "HEAD"]).is_ok();

    if has_head {
        run_git_vec_with_env(root, vec!["read-tree", "HEAD"], Some(temp_index.path()))?;
    }

    for change in changes {
        apply_staged_change_to_temp_index(root, temp_index.path(), change)?;
    }

    let tree = git_output_vec_with_env(root, vec!["write-tree"], Some(temp_index.path()))?;
    let tree = tree.trim();
    let commit = if has_head {
        git_output_vec(root, vec!["commit-tree", tree, "-p", "HEAD", "-m", message])?
    } else {
        git_output_vec(root, vec!["commit-tree", tree, "-m", message])?
    };
    let commit = commit.trim();
    run_git_vec(root, vec!["update-ref", "HEAD", commit])?;

    Ok(())
}

fn apply_staged_change_to_temp_index(
    root: &Path,
    temp_index: &Path,
    change: &GitChangedFile,
) -> io::Result<()> {
    if has_unmerged_index_entries(root, &change.relative_path)? {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Conflicted files cannot be committed from the commit panel.",
        ));
    }

    if let Some(old_relative_path) = cached_rename_old_path(root, &change.relative_path)? {
        run_git_vec_with_env(
            root,
            vec![
                "update-index",
                "--force-remove",
                "--",
                old_relative_path.as_str(),
            ],
            Some(temp_index),
        )?;
    }

    if is_cached_deletion(root, &change.relative_path)? {
        run_git_vec_with_env(
            root,
            vec![
                "update-index",
                "--force-remove",
                "--",
                change.relative_path.as_str(),
            ],
            Some(temp_index),
        )?;
        return Ok(());
    }

    let entry = git_output_vec(
        root,
        vec!["ls-files", "-s", "--", change.relative_path.as_str()],
    )?;
    let mut entries = entry.lines();
    let Some(first_entry) = entries.next() else {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("No staged content for {}.", change.relative_path),
        ));
    };

    if entries.next().is_some() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Conflicted file has multiple index entries: {}.",
                change.relative_path
            ),
        ));
    }

    let mut parts = first_entry.split_whitespace();
    let mode = parts.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Malformed Git index entry for {}.", change.relative_path),
        )
    })?;
    let object_id = parts.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Malformed Git index entry for {}.", change.relative_path),
        )
    })?;
    let stage = parts.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Malformed Git index entry for {}.", change.relative_path),
        )
    })?;

    if stage != "0" {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "Conflicted file cannot be committed: {}.",
                change.relative_path
            ),
        ));
    }

    let cacheinfo = format!("{mode},{object_id},{}", change.relative_path);
    run_git_vec_with_env(
        root,
        vec!["update-index", "--add", "--cacheinfo", cacheinfo.as_str()],
        Some(temp_index),
    )
}

fn cached_name_status_records(root: &Path) -> io::Result<Vec<Vec<String>>> {
    let output = git_output_vec(root, vec!["diff", "--cached", "--name-status", "-M"])?;
    Ok(output
        .lines()
        .map(|line| line.split('\t').map(str::to_string).collect())
        .collect())
}

fn cached_rename_old_path(root: &Path, relative_path: &str) -> io::Result<Option<String>> {
    for fields in cached_name_status_records(root)? {
        if fields.first().is_some_and(|status| status.starts_with('R'))
            && fields.get(2).is_some_and(|path| path == relative_path)
        {
            return Ok(fields.get(1).cloned());
        }
    }

    Ok(None)
}

fn is_cached_deletion(root: &Path, relative_path: &str) -> io::Result<bool> {
    Ok(cached_name_status_records(root)?.iter().any(|fields| {
        fields.first().is_some_and(|status| status == "D")
            && fields.get(1).is_some_and(|path| path == relative_path)
    }))
}

fn has_unmerged_index_entries(root: &Path, relative_path: &str) -> io::Result<bool> {
    let output = git_output_vec(root, vec!["ls-files", "-u", "--", relative_path])?;

    Ok(!output.trim().is_empty())
}

struct TempGitIndex {
    path: PathBuf,
}

impl TempGitIndex {
    fn new(root: &Path) -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root_name = root
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("workspace");
        let path = std::env::temp_dir().join(format!(
            "mockor-index-{root_name}-{}-{nanos}",
            std::process::id()
        ));

        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempGitIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn workspace_file_path(root: &Path, relative_path: &str) -> io::Result<String> {
    Ok(root
        .join(safe_relative_path(relative_path)?)
        .to_string_lossy()
        .to_string())
}

fn original_content(root: &Path, change: &GitChangedFile) -> io::Result<String> {
    if matches!(
        change.status,
        GitChangeStatus::Added | GitChangeStatus::Untracked
    ) {
        return Ok(String::new());
    }

    let relative_path = change
        .old_relative_path
        .as_deref()
        .unwrap_or(change.relative_path.as_str());
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .arg("show")
        .arg(format!("HEAD:{relative_path}"))
        .output()?;

    if !output.status.success() {
        return Ok(String::new());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn modified_content(root: &Path, change: &GitChangedFile) -> io::Result<String> {
    if change.status == GitChangeStatus::Deleted {
        return Ok(String::new());
    }

    let path = root.join(safe_relative_path(&change.relative_path)?);
    std::fs::read_to_string(path)
}

fn safe_relative_path(relative_path: &str) -> io::Result<PathBuf> {
    let path = PathBuf::from(relative_path);

    if path.is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git path is absolute.",
        ));
    }

    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    }) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git path escapes the workspace.",
        ));
    }

    Ok(path)
}

fn language_for_path(path: &str) -> String {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    match extension.as_str() {
        "css" => "css",
        "html" => "html",
        "cjs" | "js" | "jsx" | "mjs" => "javascript",
        "json" => "json",
        "md" => "markdown",
        "php" => "php",
        "rs" => "rust",
        "cts" | "mts" | "ts" | "tsx" => "typescript",
        "xml" => "xml",
        "yaml" | "yml" => "yaml",
        _ => "plaintext",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{
        parse_blame_porcelain, parse_porcelain_status, safe_relative_path,
        CommandGitRepositoryGateway, GitChangeStatus, GitChangedFile, GitRepositoryGateway,
    };
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    /// Guarantees a distinct temp-repo path for every `TestGitRepo`, even when
    /// the platform clock is too coarse to disambiguate concurrent tests.
    static TEST_REPO_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn parses_porcelain_status_changes() {
        let output =
            b" M src/User.php\0?? src/New.php\0D  old.php\0R  new.php\0old.php\0UU both.php\0";
        let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

        assert_eq!(changes[0].status, GitChangeStatus::Modified);
        assert_eq!(changes[0].relative_path, "src/User.php");
        assert_eq!(changes[1].status, GitChangeStatus::Untracked);
        assert_eq!(changes[2].status, GitChangeStatus::Deleted);
        assert_eq!(changes[3].status, GitChangeStatus::Renamed);
        assert_eq!(changes[3].old_relative_path.as_deref(), Some("old.php"));
        assert_eq!(changes[4].status, GitChangeStatus::Conflicted);
    }

    #[test]
    fn marks_index_changes_as_staged() {
        let output = b"M  staged.php\0 M unstaged.php\0A  added.php\0?? new.php\0";
        let changes = parse_porcelain_status(Path::new("/workspace"), output).expect("parse");

        assert!(changes[0].is_staged);
        assert!(!changes[1].is_staged);
        assert!(changes[2].is_staged);
        assert!(!changes[3].is_staged);
    }

    #[test]
    fn rejects_paths_outside_workspace() {
        assert!(safe_relative_path("../secret.php").is_err());
        assert!(safe_relative_path("/secret.php").is_err());
        assert!(safe_relative_path("src/User.php").is_ok());
    }

    #[test]
    fn parses_blame_porcelain_into_per_line_records() {
        // Two commits, the second reusing the first commit's metadata via a bare
        // SHA header line (the porcelain format omits author/time on repeats).
        let output = concat!(
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 1 1 2\n",
            "author Alice Example\n",
            "author-mail <alice@example.com>\n",
            "author-time 1700000000\n",
            "author-tz +0100\n",
            "committer Alice Example\n",
            "committer-mail <alice@example.com>\n",
            "committer-time 1700000000\n",
            "committer-tz +0100\n",
            "summary first commit\n",
            "filename src/User.php\n",
            "\tfirst line\n",
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 2 2\n",
            "\tsecond line\n",
            "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d 3 3 1\n",
            "author Bob Example\n",
            "author-mail <bob@example.com>\n",
            "author-time 1700100000\n",
            "author-tz +0000\n",
            "committer Bob Example\n",
            "committer-mail <bob@example.com>\n",
            "committer-time 1700100000\n",
            "committer-tz +0000\n",
            "summary third commit\n",
            "filename src/User.php\n",
            "\tthird line\n",
        );

        let lines = parse_blame_porcelain(output.as_bytes()).expect("parse blame");

        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author, "Alice Example");
        assert_eq!(lines[0].sha, "1a2b3c4");
        assert_eq!(lines[0].timestamp, 1700000000);
        // The repeated SHA inherits the metadata captured on its first appearance.
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].author, "Alice Example");
        assert_eq!(lines[1].sha, "1a2b3c4");
        assert_eq!(lines[2].line_number, 3);
        assert_eq!(lines[2].author, "Bob Example");
        assert_eq!(lines[2].sha, "f0e1d2c");
        assert_eq!(lines[2].timestamp, 1700100000);
    }

    #[test]
    fn keeps_the_final_line_when_porcelain_output_lacks_a_trailing_content_line() {
        // Defensive: a truncated porcelain stream that ends mid-group (no `\t`
        // content line) must still surface the line we already identified.
        let output = concat!(
            "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b 1 1 1\n",
            "author Alice Example\n",
            "author-time 1700000000\n",
            "summary only commit\n",
            "filename a.php\n",
            "\tfirst line\n",
            "f0e1d2c3b4a5968778695a4b3c2d1e0f9a8b7c6d 2 2 1\n",
            "author Bob Example\n",
            "author-time 1700100000\n",
        );

        let lines = parse_blame_porcelain(output.as_bytes()).expect("parse blame");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[1].line_number, 2);
        assert_eq!(lines[1].author, "Bob Example");
        assert_eq!(lines[1].sha, "f0e1d2c");
    }

    #[test]
    fn marks_uncommitted_lines_with_the_not_committed_yet_author() {
        let output = concat!(
            "0000000000000000000000000000000000000000 1 1 1\n",
            "author Not Committed Yet\n",
            "author-mail <not.committed.yet>\n",
            "author-time 1700200000\n",
            "author-tz +0000\n",
            "summary Version of staged changes\n",
            "filename new.php\n",
            "\tpending line\n",
        );

        let lines = parse_blame_porcelain(output.as_bytes()).expect("parse blame");

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].author, "Not Committed Yet");
        assert_eq!(lines[0].sha, "0000000");
    }

    #[test]
    fn blame_reports_authors_for_committed_lines() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "blame@example.com"]);
        repo.run(["config", "user.name", "Blame Author"]);
        repo.write("file.txt", "one\ntwo\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);

        let gateway = CommandGitRepositoryGateway;
        let lines = gateway.blame(repo.path(), "file.txt").expect("blame");

        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line_number, 1);
        assert_eq!(lines[0].author, "Blame Author");
        assert!(!lines[0].sha.is_empty());
        assert_eq!(lines[1].line_number, 2);
    }

    #[test]
    fn blame_rejects_paths_outside_workspace() {
        let repo = TestGitRepo::new();
        let gateway = CommandGitRepositoryGateway;

        assert!(gateway.blame(repo.path(), "../secret.txt").is_err());
    }

    #[test]
    fn commits_only_staged_content_for_selected_paths() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);
        repo.write("file.txt", "three\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .commit(
                repo.path(),
                "selected",
                &[git_changed_file(
                    "file.txt",
                    true,
                    GitChangeStatus::Modified,
                )],
            )
            .expect("commit");

        assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
        assert_eq!(repo.read("file.txt"), "three\n");
    }

    #[test]
    fn does_not_trust_deleted_payload_when_index_has_staged_content() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("file.txt", "one\n");
        repo.run(["add", "file.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("file.txt", "two\n");
        repo.run(["add", "file.txt"]);
        repo.write("file.txt", "three\n");

        let gateway = CommandGitRepositoryGateway;
        gateway
            .commit(
                repo.path(),
                "selected",
                &[git_changed_file("file.txt", true, GitChangeStatus::Deleted)],
            )
            .expect("commit");

        assert_eq!(repo.git_output(["show", "HEAD:file.txt"]), "two\n");
        assert_eq!(repo.read("file.txt"), "three\n");
    }

    #[test]
    fn derives_staged_rename_from_git_index() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("old.txt", "one\n");
        repo.run(["add", "old.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.run(["mv", "old.txt", "new.txt"]);

        let gateway = CommandGitRepositoryGateway;
        gateway
            .commit(
                repo.path(),
                "rename",
                &[git_changed_file("new.txt", true, GitChangeStatus::Modified)],
            )
            .expect("commit");

        assert_eq!(repo.git_output(["show", "HEAD:new.txt"]), "one\n");
        assert!(repo
            .git_output(["ls-tree", "--name-only", "HEAD"])
            .lines()
            .all(|path| path != "old.txt"));
    }

    #[test]
    fn reverts_staged_added_files() {
        let repo = TestGitRepo::new();
        repo.run(["config", "user.email", "test@example.com"]);
        repo.run(["config", "user.name", "Test User"]);
        repo.write("existing.txt", "one\n");
        repo.run(["add", "existing.txt"]);
        repo.run(["commit", "-m", "initial"]);
        repo.write("new.txt", "new\n");
        repo.run(["add", "new.txt"]);

        let gateway = CommandGitRepositoryGateway;
        gateway
            .revert(
                repo.path(),
                &[git_changed_file("new.txt", true, GitChangeStatus::Added)],
            )
            .expect("revert staged addition");

        assert!(!repo.path().join("new.txt").exists());
        assert_eq!(repo.git_output(["status", "--porcelain"]), "");
    }

    fn git_changed_file(
        relative_path: &str,
        is_staged: bool,
        status: GitChangeStatus,
    ) -> GitChangedFile {
        GitChangedFile {
            is_staged,
            is_unversioned: status == GitChangeStatus::Untracked,
            old_path: None,
            old_relative_path: None,
            path: format!("/workspace/{relative_path}"),
            relative_path: relative_path.to_string(),
            status,
        }
    }

    struct TestGitRepo {
        path: PathBuf,
    }

    impl TestGitRepo {
        fn new() -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time")
                .as_nanos();
            // A process-global atomic counter guarantees uniqueness across
            // parallel tests; the macOS clock only resolves to microseconds,
            // so `nanos` alone collides when tests start in the same tick and
            // both `git init` the same dir (templates/info/exclude clash).
            let unique = TEST_REPO_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "mockor-editor-git-test-{}-{nanos}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create temp repo");
            let repo = Self { path };
            repo.run(["init"]);
            repo
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn read(&self, relative_path: &str) -> String {
            fs::read_to_string(self.path.join(relative_path)).expect("read file")
        }

        fn write(&self, relative_path: &str, content: &str) {
            fs::write(self.path.join(relative_path), content).expect("write file");
        }

        fn git_output<const N: usize>(&self, args: [&str; N]) -> String {
            let output = Command::new("git")
                .arg("-C")
                .arg(&self.path)
                .args(args)
                .output()
                .expect("run git");

            assert!(
                output.status.success(),
                "git failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );

            String::from_utf8_lossy(&output.stdout).to_string()
        }

        fn run<const N: usize>(&self, args: [&str; N]) {
            self.git_output(args);
        }
    }

    impl Drop for TestGitRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}
