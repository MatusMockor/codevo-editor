use super::{history::history_output, GitCommit, GitCommitFilters};
use std::{io, path::Path};

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
        "--topo-order".to_string(),
        "--date=iso-strict".to_string(),
        "--decorate=short".to_string(),
        format!("--max-count={limit}"),
        "--pretty=format:%H%x00%h%x00%an%x00%ae%x00%aI%x00%s%x00%P%x00%B%x00%D%x00".to_string(),
    ];

    if let Some(cursor) = filters.cursor.as_deref() {
        let skip = cursor
            .parse::<usize>()
            .ok()
            .filter(|value| *value <= 500_000)
            .ok_or_else(|| io::Error::other("Invalid history page cursor."))?;
        args.push(format!("--skip={skip}"));
    }

    if let Some(author) = filters.author.as_deref().filter(|value| !value.is_empty()) {
        args.push(format!("--author={author}"));
    }

    if let Some(query) = filters.query.as_deref().filter(|value| !value.is_empty()) {
        args.push("--regexp-ignore-case".to_string());
        args.push(format!("--grep={query}"));
    }

    let branch = filters.branch.as_deref().filter(|value| !value.is_empty());
    if filters.all_branches == Some(true) && branch.is_some() {
        return Err(io::Error::other(
            "Choose all branches or one history reference.",
        ));
    }
    if filters.all_branches == Some(true) {
        args.push("--all".to_string());
        if git_ref_has_commits(root, "HEAD", trusted)? {
            args.push("HEAD".to_string());
        }
    } else {
        let reference = branch.unwrap_or("HEAD");
        if !git_ref_has_commits(root, reference, trusted)? {
            return Ok(Vec::new());
        }
        args.push(reference.to_string());
    }
    args.push("--".to_string());
    if let Some(path) = filters.path.as_deref().filter(|value| !value.is_empty()) {
        args.push(path.to_string());
    }

    let output = history_output(root, args, trusted)?;
    let mut commits = parse_commit_log_output(&output)?;
    let mut labels = super::history_refs::load_commit_labels(root, trusted)?;
    for commit in &mut commits {
        commit.labels = labels.remove(&commit.hash).unwrap_or_default();
    }
    Ok(commits)
}

fn git_ref_has_commits(root: &Path, reference: &str, trusted: bool) -> io::Result<bool> {
    if reference.is_empty()
        || reference.starts_with('-')
        || reference.len() > 4096
        || reference
            .chars()
            .any(|ch| ch.is_control() || " ~^:?*[\\".contains(ch))
        || reference.contains("..")
        || reference.contains("@{")
    {
        return Err(io::Error::other("Invalid history reference."));
    }
    match history_output(
        root,
        vec![
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
        trusted,
    ) {
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

pub(super) fn parse_commit_log_output(output: &str) -> io::Result<Vec<GitCommit>> {
    if output.is_empty() {
        return Ok(Vec::new());
    }
    let fields = output
        .strip_suffix('\0')
        .ok_or_else(|| io::Error::other("Invalid history response."))?
        .split('\0')
        .collect::<Vec<_>>();
    if fields.len() % 9 != 0 {
        return Err(io::Error::other("Invalid history response."));
    }
    fields
        .chunks_exact(9)
        .map(|fields| {
            let commit = parse_git_commit_from_fields(fields);
            if !valid_history_hash(&commit.hash)
                || commit
                    .parents
                    .iter()
                    .any(|parent| !valid_history_hash(parent))
            {
                return Err(io::Error::other("Invalid history response."));
            }
            Ok(commit)
        })
        .collect()
}

pub(super) fn parse_git_commit_from_fields(fields: &[&str]) -> GitCommit {
    let labels = Vec::new();
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

fn valid_history_hash(value: &str) -> bool {
    matches!(value.len(), 40 | 64) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
