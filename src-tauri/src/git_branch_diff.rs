use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;

use super::git_integration::{
    run_integration_command, run_integration_command_prefix, safe_object_id, CommandError,
    INTEGRATION_LOCAL_TIMEOUT,
};
use super::git_surface_status::{complete_z_records, git, parse_numstat_z, LineStat};

pub(crate) const MAX_BRANCH_DIFF_FILES: usize = 500;
pub(crate) const MAX_BRANCH_DIFF_SIDE_BYTES: usize = 128 * 1024;
pub(crate) const MAX_BRANCH_DIFF_PATH_BYTES: usize = 4_096;
pub(crate) const MAX_BASE_REF_BYTES: usize = 256;
pub(crate) const INVALID_BASE_REF_ERROR: &str = "Choose a valid base branch.";
pub(crate) const MAX_BRANCH_DIFF_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const NO_HEAD_COMMIT_ERROR: &str = "This branch has no commits yet.";
pub(crate) const BRANCH_CHANGES_UNREADABLE_ERROR: &str = "Branch changes could not be read.";
pub(crate) const SIDE_UNREADABLE_ERROR: &str = "The file could not be read from git.";
pub(crate) const INVALID_DIFF_PATH_ERROR: &str = "The file path is not valid for this repository.";
const MISSING_PATH_DIAGNOSTICS: [&str; 2] = ["does not exist in", "exists on disk, but not in"];

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchChangedFile {
    pub(crate) relative_path: String,
    pub(crate) old_relative_path: Option<String>,
    pub(crate) status: &'static str,
    pub(crate) added: Option<u32>,
    pub(crate) deleted: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchChanges {
    pub(crate) merge_base: String,
    pub(crate) head_commit: String,
    pub(crate) files: Vec<BranchChangedFile>,
    pub(crate) truncated: bool,
    pub(crate) stats_truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchSide {
    pub(crate) text: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BranchFileSides {
    pub(crate) original: BranchSide,
    pub(crate) modified: BranchSide,
    pub(crate) unavailable_reason: Option<&'static str>,
}

enum SideRead {
    Text(String),
    Missing,
    TooLarge,
    Binary,
}

pub(crate) fn safe_base_ref(candidate: &str) -> Result<String, String> {
    let invalid = candidate.is_empty()
        || candidate.len() > MAX_BASE_REF_BYTES
        || candidate.starts_with('-')
        || candidate.starts_with('/')
        || candidate.ends_with('/')
        || candidate.ends_with(".lock")
        || candidate.contains("..")
        || candidate.contains("@{")
        || candidate.chars().any(|character| {
            character.is_whitespace() || character.is_control() || "~^:?*[\\".contains(character)
        });
    if invalid {
        return Err(INVALID_BASE_REF_ERROR.to_string());
    }
    Ok(candidate.to_string())
}

pub(crate) fn safe_relative_path(candidate: &str) -> Result<String, String> {
    let invalid = candidate.is_empty()
        || candidate.len() > MAX_BRANCH_DIFF_PATH_BYTES
        || candidate.starts_with('/')
        || candidate.chars().any(char::is_control)
        || candidate
            .split('/')
            .any(|segment| segment == ".." || segment == "." || segment.is_empty());
    if invalid {
        return Err(INVALID_DIFF_PATH_ERROR.to_string());
    }
    Ok(candidate.to_string())
}

pub(crate) fn branch_changes(root: &Path, base_ref: &str) -> Result<BranchChanges, String> {
    branch_changes_bounded(root, base_ref, MAX_BRANCH_DIFF_OUTPUT_BYTES)
}

pub(crate) fn branch_changes_bounded(
    root: &Path,
    base_ref: &str,
    max_output_bytes: usize,
) -> Result<BranchChanges, String> {
    let base = safe_base_ref(base_ref)?;
    let head_commit = git(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])
        .map_err(|_| NO_HEAD_COMMIT_ERROR.to_string())?;
    let head_commit =
        safe_object_id(head_commit.trim()).map_err(|_| NO_HEAD_COMMIT_ERROR.to_string())?;
    let merge_base = git(root, &["merge-base", base.as_str(), head_commit.as_str()])
        .map_err(|_| format!("{base} has no common history with this branch."))?;
    let merge_base = safe_object_id(merge_base.trim())
        .map_err(|_| format!("{base} has no common history with this branch."))?;
    let range = [merge_base.as_str(), head_commit.as_str()];
    let (name_status, names_capped) = bounded_diff(root, "--name-status", range, max_output_bytes)?;
    let (numstat, stats_capped) = bounded_diff(root, "--numstat", range, max_output_bytes)?;
    let (stats, _) = parse_numstat_z(complete_z_records(&numstat, stats_capped), usize::MAX);
    let stats: HashMap<String, LineStat> = stats
        .into_iter()
        .map(|stat| (stat.relative_path.clone(), stat))
        .collect();
    let (entries, listed_truncated) = parse_name_status_z(
        complete_z_records(&name_status, names_capped),
        MAX_BRANCH_DIFF_FILES,
    );
    let stats_truncated = stats_capped
        && entries
            .iter()
            .any(|entry| !stats.contains_key(&entry.relative_path));
    let files = entries
        .into_iter()
        .map(|entry| {
            let stat = stats.get(&entry.relative_path);
            BranchChangedFile {
                added: stat.and_then(|stat| stat.added),
                deleted: stat.and_then(|stat| stat.deleted),
                ..entry
            }
        })
        .collect();
    Ok(BranchChanges {
        merge_base,
        head_commit,
        files,
        truncated: listed_truncated || names_capped,
        stats_truncated,
    })
}

fn bounded_diff(
    root: &Path,
    format: &str,
    range: [&str; 2],
    max_output_bytes: usize,
) -> Result<(String, bool), String> {
    let arguments = ["diff", format, "-z", "-M", range[0], range[1], "--"].map(OsStr::new);
    run_integration_command_prefix(
        root,
        &arguments,
        INTEGRATION_LOCAL_TIMEOUT,
        max_output_bytes,
    )
    .map_err(|_| BRANCH_CHANGES_UNREADABLE_ERROR.to_string())
}

pub(crate) fn parse_name_status_z(output: &str, limit: usize) -> (Vec<BranchChangedFile>, bool) {
    let mut records = output.split('\0');
    let mut files = Vec::new();
    while let Some(code) = records.next() {
        if code.is_empty() {
            continue;
        }
        let renamed = code.starts_with('R') || code.starts_with('C');
        let first = records.next().unwrap_or_default();
        let (old_relative_path, relative_path) = match renamed {
            true => (
                safe_relative_path(first).ok(),
                records.next().unwrap_or_default(),
            ),
            false => (None, first),
        };
        if safe_relative_path(relative_path).is_err() {
            continue;
        }
        if files.len() >= limit {
            return (files, true);
        }
        files.push(BranchChangedFile {
            relative_path: relative_path.to_string(),
            old_relative_path,
            status: status_name(code),
            added: None,
            deleted: None,
        });
    }
    (files, false)
}

pub(crate) fn branch_file_sides(
    root: &Path,
    merge_base: &str,
    head_commit: &str,
    relative_path: &str,
    old_relative_path: Option<&str>,
) -> Result<BranchFileSides, String> {
    let merge_base = safe_object_id(merge_base)?;
    let head_commit = safe_object_id(head_commit)?;
    let path = safe_relative_path(relative_path)?;
    let old_path = match old_relative_path {
        Some(old) => safe_relative_path(old)?,
        None => path.clone(),
    };
    let original = read_side(root, &merge_base, &old_path)?;
    let modified = read_side(root, &head_commit, &path)?;
    Ok(sides(original, modified))
}

fn sides(original: SideRead, modified: SideRead) -> BranchFileSides {
    if matches!(original, SideRead::Binary) || matches!(modified, SideRead::Binary) {
        return unavailable("binary");
    }
    if matches!(original, SideRead::TooLarge) || matches!(modified, SideRead::TooLarge) {
        return unavailable("large");
    }
    BranchFileSides {
        original: text_side(original),
        modified: text_side(modified),
        unavailable_reason: None,
    }
}

fn unavailable(reason: &'static str) -> BranchFileSides {
    BranchFileSides {
        original: empty_side(),
        modified: empty_side(),
        unavailable_reason: Some(reason),
    }
}

fn empty_side() -> BranchSide {
    BranchSide {
        text: String::new(),
    }
}

fn text_side(side: SideRead) -> BranchSide {
    match side {
        SideRead::Text(text) => BranchSide { text },
        SideRead::Missing | SideRead::TooLarge | SideRead::Binary => empty_side(),
    }
}

fn read_side(root: &Path, revision: &str, path: &str) -> Result<SideRead, String> {
    let spec = format!("{revision}:{path}");
    let Some(size) = side_size(run_integration_command(
        root,
        &[
            OsStr::new("cat-file"),
            OsStr::new("-s"),
            OsStr::new(spec.as_str()),
        ],
        INTEGRATION_LOCAL_TIMEOUT,
    ))?
    else {
        return Ok(SideRead::Missing);
    };
    if size > MAX_BRANCH_DIFF_SIDE_BYTES {
        return Ok(SideRead::TooLarge);
    }
    let text = git(root, &["cat-file", "blob", spec.as_str()])
        .map_err(|_| SIDE_UNREADABLE_ERROR.to_string())?;
    if text.contains('\0') {
        return Ok(SideRead::Binary);
    }
    Ok(SideRead::Text(text))
}

fn side_size(probe: Result<String, CommandError>) -> Result<Option<usize>, String> {
    let output = match probe {
        Ok(output) => output,
        Err(CommandError::Failed(message)) if names_a_missing_path(&message) => return Ok(None),
        Err(_) => return Err(SIDE_UNREADABLE_ERROR.to_string()),
    };
    output
        .trim()
        .parse()
        .map(Some)
        .map_err(|_| SIDE_UNREADABLE_ERROR.to_string())
}

fn names_a_missing_path(message: &str) -> bool {
    MISSING_PATH_DIAGNOSTICS
        .iter()
        .any(|diagnostic| message.contains(diagnostic))
}

fn status_name(code: &str) -> &'static str {
    match code.chars().next() {
        Some('A') | Some('C') => "added",
        Some('D') => "deleted",
        Some('R') => "renamed",
        _ => "modified",
    }
}

#[cfg(test)]
#[path = "git_branch_diff_tests.rs"]
mod tests;
