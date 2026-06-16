use serde::{Deserialize, Serialize};
use std::{
    io,
    path::{Component, Path, PathBuf},
    process::Command,
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

pub trait GitRepositoryGateway {
    fn diff(&self, root: &Path, change: &GitChangedFile) -> io::Result<GitFileDiff>;
    fn status(&self, root: &Path) -> io::Result<GitStatus>;
}

pub struct CommandGitRepositoryGateway;

impl GitRepositoryGateway for CommandGitRepositoryGateway {
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
            old_path,
            old_relative_path,
            path,
            relative_path,
            status,
        });
    }

    Ok(changes)
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
        "js" | "jsx" => "javascript",
        "json" => "json",
        "md" => "markdown",
        "php" => "php",
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "xml" => "xml",
        "yaml" | "yml" => "yaml",
        _ => "plaintext",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::{parse_porcelain_status, safe_relative_path, GitChangeStatus};
    use std::path::Path;

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
    fn rejects_paths_outside_workspace() {
        assert!(safe_relative_path("../secret.php").is_err());
        assert!(safe_relative_path("/secret.php").is_err());
        assert!(safe_relative_path("src/User.php").is_ok());
    }
}
