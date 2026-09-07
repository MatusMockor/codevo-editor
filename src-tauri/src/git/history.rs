use super::history_log::parse_commit_log_output;
use super::{
    git_command, language_for_path, safe_commit_sha, CommitDiffPayload, CommitFileChange,
    GitCommitDetails,
};
use std::{io, path::Path, time::Duration};

const MAX_HISTORY_BYTES: usize = 2_000_000;

pub(super) fn history_output<S: AsRef<str>>(
    root: &Path,
    args: Vec<S>,
    trusted: bool,
) -> io::Result<String> {
    let mut command = git_command(trusted);
    command
        .arg("-C")
        .arg(root)
        .args(args.iter().map(AsRef::as_ref));
    let bytes = super::bounded_process::run_bounded_command_bytes(
        command,
        Duration::from_secs(15),
        MAX_HISTORY_BYTES,
    )
    .map_err(|error| {
        io::Error::other(format!("Git history unavailable: {}", error.into_message()))
    })?;
    String::from_utf8(bytes)
        .map_err(|_| io::Error::other("Git history contains non-UTF-8 data; preview unavailable."))
}

fn history_blob(root: &Path, object: &str, trusted: bool) -> io::Result<String> {
    let content = history_output(root, vec!["cat-file", "blob", object], trusted).map_err(|error| {
        if error.to_string() == format!("Git history unavailable: Git worktree output exceeded the {MAX_HISTORY_BYTES} byte limit.") {
            return io::Error::other("File exceeds the preview size limit.");
        }
        error
    })?;
    if content.contains('\0') {
        return Err(io::Error::other("Binary file; text preview unavailable."));
    }
    Ok(content)
}

pub fn load_commit_details(
    root: &Path,
    commit_hash: &str,
    trusted: bool,
) -> io::Result<GitCommitDetails> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let command =
        "--pretty=format:%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%B%x00%D%x00".to_string();
    let output = history_output(root, vec!["show", "-s", &command, &commit_hash], trusted)?;
    let mut commit = parse_commit_log_output(&output)?
        .into_iter()
        .next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Commit not found."))?;

    commit.labels = super::history_refs::load_commit_labels(root, trusted)?
        .remove(&commit.hash)
        .unwrap_or_default();
    let body = history_output(
        root,
        vec!["log", "-1", "--pretty=%B", &commit_hash],
        trusted,
    )?
    .trim_end()
    .to_string();

    let containing_local = history_output(
        root,
        vec![
            "branch",
            "--format=%(refname:short)",
            "--contains",
            &commit_hash,
        ],
        trusted,
    )?;
    let containing_remote = history_output(
        root,
        vec![
            "branch",
            "--remotes",
            "--format=%(refname:short)",
            "--contains",
            &commit_hash,
        ],
        trusted,
    )?;

    let mut containing_branches = containing_local
        .lines()
        .filter_map(|value| {
            let branch = value.trim();
            if branch.is_empty() {
                None
            } else {
                Some(branch.to_string())
            }
        })
        .collect::<Vec<_>>();

    let remote_branches = containing_remote
        .lines()
        .filter_map(|value| {
            let branch = value.trim();
            if branch.is_empty() {
                None
            } else {
                Some(branch.to_string())
            }
        })
        .collect::<Vec<_>>();

    for branch in remote_branches {
        if !containing_branches.contains(&branch) {
            containing_branches.push(branch);
        }
    }

    Ok(GitCommitDetails {
        commit,
        body,
        containing_branches,
    })
}

pub fn load_commit_files(
    root: &Path,
    commit_hash: &str,
    trusted: bool,
) -> io::Result<Vec<CommitFileChange>> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let output = history_output(
        root,
        vec![
            "diff-tree",
            "--root",
            "--first-parent",
            "-m",
            "--no-commit-id",
            "-r",
            "-M",
            "--name-status",
            "-z",
            &commit_hash,
        ],
        trusted,
    )?;

    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    let mut files = Vec::new();
    while let Some(status) = fields.next() {
        let first = fields
            .next()
            .ok_or_else(|| io::Error::other("Invalid commit file list."))?;
        let (path, old_path, new_path) = if status.starts_with('R') || status.starts_with('C') {
            let next = fields
                .next()
                .ok_or_else(|| io::Error::other("Invalid renamed commit file."))?;
            (next, Some(first.to_string()), Some(next.to_string()))
        } else {
            (first, None, None)
        };
        files.push(CommitFileChange {
            is_rename: status.starts_with('R'),
            path: path.to_string(),
            old_path,
            new_path,
            status: match status.chars().next() {
                Some('A') => "A",
                Some('D') => "D",
                Some('R') => "R",
                Some('M' | 'T') => "M",
                _ => return Err(io::Error::other("Unsupported historical file change.")),
            }
            .to_string(),
        });
    }
    Ok(files)
}

pub fn load_commit_diff(
    root: &Path,
    commit_hash: &str,
    path: &str,
    old_path: Option<&str>,
    files: &[CommitFileChange],
    trusted: bool,
) -> io::Result<CommitDiffPayload> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let normalized_old_path = old_path.unwrap_or(path);

    let file = files
        .iter()
        .find(|candidate| {
            if candidate.is_rename {
                candidate.path == path
                    || candidate
                        .old_path
                        .as_deref()
                        .is_some_and(|value| value == normalized_old_path)
            } else {
                candidate.path == path
            }
        })
        .or_else(|| {
            files
                .iter()
                .find(|candidate| candidate.path == normalized_old_path)
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Commit file not found."))?;

    let normalized_old_path = file.old_path.as_deref().unwrap_or(normalized_old_path);
    let old_content = if file.status == "A" {
        String::new()
    } else {
        history_blob(
            root,
            &format!("{}^:{}", commit_hash, normalized_old_path),
            trusted,
        )?
    };
    let modified_content = if file.status == "D" {
        String::new()
    } else {
        history_blob(root, &format!("{}:{}", commit_hash, path), trusted)?
    };

    Ok(CommitDiffPayload {
        commit_hash: commit_hash.to_string(),
        is_rename: file.is_rename,
        language: language_for_path(path),
        modified_content,
        old_path: old_path.map(ToOwned::to_owned),
        original_content: old_content,
        path: path.to_string(),
        status: file.status.to_string(),
    })
}
