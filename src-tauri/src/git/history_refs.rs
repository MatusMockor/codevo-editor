use super::{history::history_output, GitBranches};
use std::{collections::BTreeMap, io, path::Path};

pub fn load_git_branches(root: &Path, trusted: bool) -> io::Result<GitBranches> {
    let output = history_output(
        root,
        vec![
            "for-each-ref",
            "--count=5001",
            "--format=%(refname)%00%(symref)",
            "refs/heads/",
            "refs/remotes/",
        ],
        trusted,
    )?;
    if output.lines().count() > 5000 {
        return Err(io::Error::other(
            "Repository exceeds the 5000 branch display limit.",
        ));
    }
    let mut local = Vec::new();
    let mut remotes: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for line in output.lines() {
        let (reference, symbolic) = line
            .split_once('\0')
            .ok_or_else(|| io::Error::other("Invalid Git branch response."))?;
        if reference.len() > 4096 || reference.chars().any(char::is_control) {
            return Err(io::Error::other("Invalid Git branch response."));
        }
        if !symbolic.is_empty() {
            continue;
        }
        if let Some(branch) = reference.strip_prefix("refs/heads/") {
            local.push(branch.to_string());
            continue;
        }
        let (remote, branch) = reference
            .strip_prefix("refs/remotes/")
            .and_then(|value| value.split_once('/'))
            .filter(|(remote, branch)| !remote.is_empty() && !branch.is_empty())
            .ok_or_else(|| io::Error::other("Invalid Git remote branch response."))?;
        if branch == "HEAD" {
            continue;
        }
        remotes
            .entry(remote.to_string())
            .or_default()
            .push(branch.to_string());
    }
    let current = history_output(root, vec!["branch", "--show-current"], trusted)?;
    let current = current.trim();
    Ok(GitBranches {
        current: (!current.is_empty()).then(|| current.to_string()),
        local,
        remotes,
    })
}

pub(super) fn load_commit_labels(
    root: &Path,
    trusted: bool,
) -> io::Result<BTreeMap<String, Vec<String>>> {
    let output = history_output(
        root,
        vec![
            "for-each-ref",
            "--count=5001",
            "--format=%(objectname)%00%(refname)%00%(*objectname)%00%(symref)",
        ],
        trusted,
    )?;
    if output.lines().count() > 5000 {
        return Err(io::Error::other(
            "Repository exceeds the 5000 reference display limit.",
        ));
    }
    let mut labels: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for line in output.lines() {
        let fields = line.split('\0').collect::<Vec<_>>();
        if fields.len() != 4 {
            return Err(io::Error::other("Invalid Git reference response."));
        }
        if !fields[3].is_empty() {
            continue;
        }
        let label = if let Some(name) = fields[1].strip_prefix("refs/heads/") {
            name.to_string()
        } else if let Some(name) = fields[1].strip_prefix("refs/remotes/") {
            name.to_string()
        } else if let Some(name) = fields[1].strip_prefix("refs/tags/") {
            format!("tag: {name}")
        } else {
            continue;
        };
        let hash = if fields[2].is_empty() {
            fields[0]
        } else {
            fields[2]
        };
        labels.entry(hash.to_string()).or_default().push(label);
    }
    Ok(labels)
}
