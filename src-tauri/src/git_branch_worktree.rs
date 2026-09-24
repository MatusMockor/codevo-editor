use super::{
    canonical_repository_root, collect_worktree_command, compensate_failed_worktree_add,
    ensure_agent_worktree_base, ensure_agent_worktree_excluded, ensure_branch_bounds,
    ensure_path_bounds, ensure_worktree_path_in_base, local_branch_head, repository_head,
    run_worktree_command, sanitize_git_failure_reason, AgentWorktreeCreationLock,
    CommandGitWorktreeGateway, GitWorktreeGateway, LOCAL_BRANCH_REF_PREFIX,
    MAX_WORKTREES_PER_REPOSITORY,
};
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const BRANCH_WORKTREE_PREFIX: &str = "branch-";
const MAX_START_POINT_BYTES: usize = 256;
const QUALIFIED_START_POINT_PREFIXES: [&str; 2] = ["refs/heads/", "refs/remotes/"];
const BRANCH_DIRECTORY_HASH_BYTES: usize = 4;
pub(crate) const BRANCH_DIRECTORY_IN_USE_ERROR: &str =
    "The worktree folders for this branch name are already in use. Remove the leftover folder in .worktrees or choose another branch name.";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct CreatedBranchWorktree {
    pub(crate) worktree_path: PathBuf,
    pub(crate) branch: String,
}

pub(crate) fn resolve_worktree_start_point(root: &Path, reference: &str) -> Result<String, String> {
    let invalid = reference.is_empty()
        || reference.len() > MAX_START_POINT_BYTES
        || reference.starts_with('-')
        || reference.contains("..")
        || reference.contains("@{")
        || reference
            .chars()
            .any(|character| character.is_whitespace() || character.is_control());
    if invalid {
        return Err("Choose a valid branch to start from.".to_string());
    }
    ensure_start_point_format(root, reference)?;
    let target = format!("{reference}^{{commit}}");
    let output = run_worktree_command(
        root,
        &[
            OsStr::new("rev-parse"),
            OsStr::new("--verify"),
            OsStr::new("--quiet"),
            OsStr::new("--end-of-options"),
            OsStr::new(target.as_str()),
        ],
    )
    .map_err(|_| format!("{reference} does not exist."))?;
    let sha = output.trim().to_string();
    let hex = (sha.len() == 40 || sha.len() == 64)
        && sha.chars().all(|character| character.is_ascii_hexdigit());
    if !hex {
        return Err("Git reported an unusable start point.".to_string());
    }
    Ok(sha)
}

fn ensure_start_point_format(root: &Path, reference: &str) -> Result<(), String> {
    let qualified = QUALIFIED_START_POINT_PREFIXES
        .iter()
        .any(|prefix| reference.starts_with(prefix));
    if qualified {
        return check_ref_format(root, &[OsStr::new(reference)]);
    }
    if reference.starts_with("refs/") {
        return Err("Choose a local or remote branch to start from.".to_string());
    }
    ensure_branch_bounds(reference)?;
    check_ref_format(root, &[OsStr::new("--branch"), OsStr::new(reference)])?;
    let candidates = [
        format!("{LOCAL_BRANCH_REF_PREFIX}{reference}"),
        format!("refs/remotes/{reference}"),
    ];
    if !candidates.iter().any(|full| ref_exists(root, full)) {
        return Err(format!("{reference} is not a local or remote branch."));
    }
    Ok(())
}

fn check_ref_format(root: &Path, arguments: &[&OsStr]) -> Result<(), String> {
    let mut command = vec![OsStr::new("check-ref-format")];
    command.extend_from_slice(arguments);
    run_worktree_command(root, &command)
        .map(|_| ())
        .map_err(|_| "Choose a valid branch to start from.".to_string())
}

fn ref_exists(root: &Path, full_reference: &str) -> bool {
    collect_worktree_command(
        root,
        &[
            OsStr::new("show-ref"),
            OsStr::new("--verify"),
            OsStr::new("--quiet"),
            OsStr::new(full_reference),
        ],
    )
    .is_ok_and(|result| result.success)
}

pub(crate) fn branch_worktree_directory_name(branch: &str) -> String {
    let sanitized: String = branch
        .chars()
        .map(|character| {
            match character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                true => character,
                false => '-',
            }
        })
        .collect();
    format!("{BRANCH_WORKTREE_PREFIX}{}", sanitized.trim_matches('-'))
}

fn branch_worktree_directory_candidates(branch: &str) -> [String; 2] {
    let readable = branch_worktree_directory_name(branch);
    let digest = Sha256::digest(branch.as_bytes());
    let suffix: String = digest
        .iter()
        .take(BRANCH_DIRECTORY_HASH_BYTES)
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let hashed = format!("{readable}-{suffix}");
    [readable, hashed]
}

fn reserve_branch_worktree_target(
    base: &Path,
    branch: &str,
) -> Result<(PathBuf, AgentWorktreeCreationLock), String> {
    for directory in branch_worktree_directory_candidates(branch) {
        let target = base.join(&directory);
        ensure_path_bounds(&target)?;
        if target.symlink_metadata().is_ok() {
            continue;
        }
        let guard = AgentWorktreeCreationLock::acquire(base, &directory)?;
        if target.symlink_metadata().is_ok() {
            continue;
        }
        return Ok((target, guard));
    }
    Err(BRANCH_DIRECTORY_IN_USE_ERROR.to_string())
}

pub(crate) fn add_branch_worktree(
    repository_root: &Path,
    branch: &str,
    start_point: Option<&str>,
) -> Result<CreatedBranchWorktree, String> {
    let root = canonical_repository_root(repository_root)?;
    if branch.is_empty() || branch.starts_with('-') || branch.contains("@{") {
        return Err("Choose a valid branch name.".to_string());
    }
    ensure_branch_bounds(branch)?;
    run_worktree_command(
        &root,
        &[
            OsStr::new("check-ref-format"),
            OsStr::new("--branch"),
            OsStr::new(branch),
        ],
    )
    .map_err(|_| "Choose a valid branch name.".to_string())?;
    let existing_head = local_branch_head(&root, branch)?;
    if existing_head.is_some() && start_point.is_some() {
        return Err("A branch with this name already exists.".to_string());
    }
    let start = match (existing_head.is_some(), start_point) {
        (true, _) => None,
        (false, Some(reference)) => Some(resolve_worktree_start_point(&root, reference)?),
        (false, None) => Some(repository_head(&root)?),
    };
    ensure_agent_worktree_excluded(&root)?;
    let base = ensure_agent_worktree_base(&root)?;
    let (target, _add_guard) = reserve_branch_worktree_target(&base, branch)?;
    let existing = CommandGitWorktreeGateway::new().list_worktrees(&root)?;
    if existing.len() >= MAX_WORKTREES_PER_REPOSITORY {
        return Err(format!(
            "Repository already holds the maximum of {MAX_WORKTREES_PER_REPOSITORY} worktrees."
        ));
    }
    match start {
        Some(start) => add_new_branch_worktree(&root, &target, branch, &start)?,
        None => add_existing_branch_worktree(&root, &target, branch)?,
    }
    let worktree_path = ensure_worktree_path_in_base(&root, &target)?;
    Ok(CreatedBranchWorktree {
        worktree_path,
        branch: branch.to_string(),
    })
}

fn add_new_branch_worktree(
    root: &Path,
    target: &Path,
    branch: &str,
    start: &str,
) -> Result<(), String> {
    let result = run_worktree_command(
        root,
        &[
            OsStr::new("worktree"),
            OsStr::new("add"),
            OsStr::new("-b"),
            OsStr::new(branch),
            target.as_os_str(),
            OsStr::new(start),
        ],
    );
    let Err(error) = result else {
        return Ok(());
    };
    if compensate_failed_worktree_add(root, target, branch, start) {
        return Err(sanitize_git_failure_reason(&error));
    }
    Err(sanitize_git_failure_reason(&format!(
        "{error} Cleanup could not be completed; remove the partial worktree or branch before retrying."
    )))
}

fn add_existing_branch_worktree(root: &Path, target: &Path, branch: &str) -> Result<(), String> {
    let result = run_worktree_command(
        root,
        &[
            OsStr::new("worktree"),
            OsStr::new("add"),
            target.as_os_str(),
            OsStr::new(branch),
        ],
    );
    let Err(error) = result else {
        return Ok(());
    };
    let _ = fs::remove_dir(target);
    Err(sanitize_git_failure_reason(&error))
}

#[cfg(test)]
#[path = "git_branch_worktree_tests.rs"]
mod tests;
