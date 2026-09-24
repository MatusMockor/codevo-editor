use super::git_branch_diff::safe_base_ref;
use super::git_surface_status;
use super::pull_request::strip_remote_prefix;
use std::path::Path;

const DEFAULT_BASE_CANDIDATES: [&str; 4] = ["main", "master", "trunk", "develop"];

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PullRequestBase {
    pub(crate) forge_name: String,
    pub(crate) comparison: String,
}

pub(crate) fn resolve_requested_base(
    worktree: &Path,
    remote: Option<&str>,
    requested: &str,
) -> PullRequestBase {
    let remote_qualified = remote
        .and_then(|remote| strip_remote_prefix(requested, remote))
        .filter(|_| {
            ref_exists(worktree, &format!("refs/remotes/{requested}"))
                && !ref_exists(worktree, &format!("refs/heads/{requested}"))
        });
    if let Some(branch) = remote_qualified {
        return PullRequestBase {
            forge_name: branch.to_string(),
            comparison: requested.to_string(),
        };
    }
    PullRequestBase {
        forge_name: requested.to_string(),
        comparison: comparison_ref(worktree, remote, requested),
    }
}

pub(crate) fn resolve_default_base(
    worktree: &Path,
    remote: Option<&str>,
    local_branches: &[String],
) -> Option<PullRequestBase> {
    let candidate = remote
        .and_then(|remote| remote_head(worktree, remote))
        .or_else(|| git_surface_status::default_base(worktree, local_branches))
        .or_else(|| remote.and_then(|remote| remote_candidate(worktree, remote)))?;
    let base = resolve_requested_base(worktree, remote, &candidate);
    safe_base_ref(&base.forge_name).ok()?;
    Some(base)
}

fn remote_head(worktree: &Path, remote: &str) -> Option<String> {
    let reference = format!("refs/remotes/{remote}/HEAD");
    let output = git_surface_status::git(
        worktree,
        &["symbolic-ref", "--quiet", "--short", reference.as_str()],
    )
    .ok()?;
    let short = output.trim();
    strip_remote_prefix(short, remote)?;
    safe_base_ref(short).ok()
}

fn remote_candidate(worktree: &Path, remote: &str) -> Option<String> {
    DEFAULT_BASE_CANDIDATES
        .iter()
        .find(|candidate| ref_exists(worktree, &format!("refs/remotes/{remote}/{candidate}")))
        .map(|candidate| candidate.to_string())
}

fn comparison_ref(worktree: &Path, remote: Option<&str>, branch: &str) -> String {
    if ref_exists(worktree, &format!("refs/heads/{branch}")) {
        return branch.to_string();
    }
    let Some(remote) = remote else {
        return branch.to_string();
    };
    let tracking = format!("{remote}/{branch}");
    if ref_exists(worktree, &format!("refs/remotes/{tracking}")) {
        return tracking;
    }
    branch.to_string()
}

fn ref_exists(worktree: &Path, reference: &str) -> bool {
    git_surface_status::git(worktree, &["show-ref", "--verify", "--quiet", reference]).is_ok()
}
