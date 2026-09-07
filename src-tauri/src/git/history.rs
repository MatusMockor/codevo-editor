use super::{
    git_command, language_for_path, safe_commit_sha, CommitDiffPayload, CommitFileChange,
    GitCommit, GitCommitDetails, GitCommitFilters,
};
use std::{io, path::Path, time::Duration};

const MAX_HISTORY_BYTES: usize = 2_000_000;

fn history_output<S: AsRef<str>>(root: &Path, args: Vec<S>, trusted: bool) -> io::Result<String> {
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

pub fn load_commit_log(
    root: &Path,
    filters: GitCommitFilters,
    trusted: bool,
) -> io::Result<Vec<GitCommit>> {
    if [
        &filters.author,
        &filters.branch,
        &filters.cursor,
        &filters.path,
        &filters.query,
    ]
    .into_iter()
    .flatten()
    .any(|value| value.len() > 4096 || value.contains('\0'))
    {
        return Err(io::Error::other(
            "Git history filter exceeds the supported limits.",
        ));
    }
    let limit = filters.limit.unwrap_or(100);
    if !(1..=500).contains(&limit) {
        return Err(io::Error::other(
            "Git history page limit must be between 1 and 500.",
        ));
    }
    let mut args: Vec<String> = vec![
        "log".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        format!("--max-count={limit}"),
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%B%x1f%D%x00".to_string(),
    ];

    if let Some(skip) = filters
        .cursor
        .as_deref()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
    {
        args.push(format!("--skip={skip}"));
    }

    if let Some(author) = filters.author.as_deref().filter(|value| !value.is_empty()) {
        args.push(format!("--author={author}"));
    }

    if let Some(query) = filters.query.as_deref().filter(|value| !value.is_empty()) {
        args.push("--regexp-ignore-case".to_string());
        args.push(format!("--grep={query}"));
    }

    let range_ref = filters.branch.unwrap_or_else(|| "HEAD".to_string());
    if !git_ref_has_commits(root, &range_ref, trusted)? {
        return Ok(Vec::new());
    }

    args.push(range_ref);

    if let Some(path) = filters.path.as_deref().filter(|value| !value.is_empty()) {
        args.push("--".to_string());
        args.push(path.to_string());
    }

    let output = history_output(root, args, trusted)?;
    Ok(parse_commit_log_output(&output))
}

fn git_ref_has_commits(root: &Path, reference: &str, trusted: bool) -> io::Result<bool> {
    if reference.is_empty() || reference.starts_with('-') || reference.len() > 4096 {
        return Err(io::Error::other("Invalid history reference."));
    }
    match history_output(root, vec!["rev-parse", "--verify", reference], trusted) {
        Ok(_) => Ok(true),
        Err(error) => {
            if reference == "HEAD" {
                let symbolic = history_output(root, vec!["symbolic-ref", "-q", "HEAD"], trusted)?;
                let refs = history_output(
                    root,
                    vec!["for-each-ref", "--format=%(refname)", symbolic.trim()],
                    trusted,
                )?;
                if !refs.lines().any(|line| line == symbolic.trim()) {
                    return Ok(false);
                }
            }
            Err(error)
        }
    }
}

fn parse_commit_log_output(output: &str) -> Vec<GitCommit> {
    output
        .split('\0')
        .filter(|entry| !entry.trim().is_empty())
        .filter_map(|entry| {
            let fields: Vec<&str> = entry.split('\x1f').collect();
            if fields.len() < 9 {
                return None;
            }

            Some(parse_git_commit_from_fields(&fields))
        })
        .collect()
}

fn parse_git_commit_from_fields(fields: &[&str]) -> GitCommit {
    let labels = parse_git_labels(fields[8]);
    let parents = fields[6]
        .split_whitespace()
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect();

    GitCommit {
        abbrev_hash: fields[1].trim().to_string(),
        author_email: fields[3].trim().to_string(),
        author_name: fields[2].trim().to_string(),
        date: fields[4].trim().to_string(),
        hash: fields[0].trim().to_string(),
        labels,
        parents,
        subject: fields[5].trim().to_string(),
    }
}

fn parse_git_labels(value: &str) -> Vec<String> {
    let raw = value.trim().trim_start_matches('(').trim_end_matches(')');
    if raw.is_empty() {
        return Vec::new();
    }

    raw.split(',')
        .filter_map(|piece| {
            let label = piece.trim();
            if label.is_empty() || label == "HEAD" || label == "tag: HEAD" {
                return None;
            }

            if label.starts_with("tag: ") || label.starts_with("origin/") {
                Some(label.to_string())
            } else if label.starts_with("HEAD -> ") {
                Some(
                    label
                        .split("->")
                        .nth(1)
                        .map(str::trim)
                        .unwrap_or_default()
                        .to_string(),
                )
            } else {
                Some(label.to_string())
            }
        })
        .collect()
}

pub fn load_commit_details(
    root: &Path,
    commit_hash: &str,
    trusted: bool,
) -> io::Result<GitCommitDetails> {
    let commit_hash = safe_commit_sha(commit_hash)?;
    let command =
        "--pretty=format:%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%P%x1f%B%x1f%D%x00".to_string();
    let output = history_output(root, vec!["show", "-s", &command, &commit_hash], trusted)?;
    let commit = output
        .split('\0')
        .find(|entry| !entry.trim().is_empty())
        .and_then(|entry| {
            let fields: Vec<&str> = entry.split('\x1f').collect();
            (fields.len() >= 9).then(|| parse_git_commit_from_fields(&fields))
        })
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Commit not found."))?;

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
