use super::{
    bounded_process::CommandError,
    discard_guard::{
        discard_settled, fingerprint, refuse_submodules, require_paths_in_place, revalidate,
    },
    discard_restore::restore_without_clobbering,
    pinned_root::{repository_file_path, PinnedRoot},
    GitChangeStatus,
};
use serde::{Deserialize, Serialize};
use std::{io, path::Path};

pub(crate) const DISCARD_STALE_ERROR: &str =
    "The file changed since you confirmed. Review it and try again.";
pub(crate) const DISCARD_CLEAN_ERROR: &str = "The file no longer has changes to discard.";
pub(crate) const DISCARD_CONFLICT_ERROR: &str = "Resolve the conflict before discarding this file.";
pub(crate) const DISCARD_UNTRACKED_OVERLAP_ERROR: &str =
    "An untracked or ignored file is in the way. Move or delete it before discarding these changes.";
pub(crate) const DISCARD_PATH_BLOCKED_ERROR: &str =
    "Something else is now at this path (a file, folder or link). Move it before discarding these changes.";
pub(crate) const DISCARD_SUBMODULE_ERROR: &str = "Submodules can't be discarded here.";
pub(crate) const DISCARD_CONTENT_CHANGED_ERROR: &str =
    "The file was edited after you opened the dialog. Review it and try again.";
pub(crate) const DISCARD_INCOMPLETE_ERROR: &str =
    "Git could not fully discard the changes. Refresh and check the file.";
const DISCARD_ROOT_ERROR: &str = "Select the repository root before discarding changes.";
const COMMAND_OUTPUT_BYTES: usize = 64 * 1024;
const FINGERPRINT_HEX_LENGTH: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitDiscardFile {
    pub(crate) relative_path: String,
    pub(crate) old_relative_path: Option<String>,
    pub(crate) expected_status: GitChangeStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiscardPreparation {
    pub(crate) fingerprint: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GitDiscardAction {
    Restored,
    Deleted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiscardReceipt {
    pub(crate) relative_path: String,
    pub(crate) action: GitDiscardAction,
}

pub(super) struct DiscardPlan {
    pub(super) restore: Option<String>,
    pub(super) remove: Option<String>,
    pub(super) restore_must_be_absent: bool,
}

impl DiscardPlan {
    fn for_request(request: &GitDiscardFile) -> Self {
        let path = request.relative_path.clone();
        match request.expected_status {
            GitChangeStatus::Untracked | GitChangeStatus::Added => Self {
                restore: None,
                remove: Some(path),
                restore_must_be_absent: false,
            },
            GitChangeStatus::Modified => Self {
                restore: Some(path),
                remove: None,
                restore_must_be_absent: false,
            },
            GitChangeStatus::Deleted => Self {
                restore: Some(path),
                remove: None,
                restore_must_be_absent: true,
            },
            GitChangeStatus::Renamed => Self {
                restore: request.old_relative_path.clone(),
                remove: Some(path),
                restore_must_be_absent: true,
            },
            GitChangeStatus::Conflicted => Self {
                restore: None,
                remove: None,
                restore_must_be_absent: false,
            },
        }
    }
}

struct Prepared {
    root: PinnedRoot,
    paths: Vec<String>,
    plan: DiscardPlan,
    fingerprint: String,
}

pub(crate) fn prepare_discard(
    root: &Path,
    request: &GitDiscardFile,
    trusted: bool,
) -> io::Result<GitDiscardPreparation> {
    let prepared = prepare(root, request, trusted)?;
    Ok(GitDiscardPreparation {
        fingerprint: prepared.fingerprint,
    })
}

pub(crate) fn discard_file(
    root: &Path,
    request: &GitDiscardFile,
    expected_fingerprint: &str,
    trusted: bool,
) -> io::Result<GitDiscardReceipt> {
    if expected_fingerprint.len() != FINGERPRINT_HEX_LENGTH
        || !expected_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid("The discard confirmation is invalid."));
    }
    let Prepared {
        root,
        paths,
        plan,
        fingerprint,
    } = prepare(root, request, trusted)?;
    if fingerprint != expected_fingerprint {
        return Err(invalid(DISCARD_CONTENT_CHANGED_ERROR));
    }
    root.validate()?;
    if let Some(restore) = plan.restore.as_deref() {
        if plan.restore_must_be_absent {
            restore_without_clobbering(&root, restore, trusted)?;
        } else {
            run(
                &root,
                &[
                    "--literal-pathspecs",
                    "restore",
                    "--source=HEAD",
                    "--staged",
                    "--worktree",
                    "--",
                    restore,
                ],
                trusted,
            )?;
        }
    }
    if let Some(remove) = plan.remove.as_deref() {
        run(
            &root,
            &["update-index", "--force-remove", "--", remove],
            trusted,
        )?;
        run(
            &root,
            &[
                "--literal-pathspecs",
                "clean",
                "-f",
                "-x",
                "-q",
                "--",
                remove,
            ],
            trusted,
        )?;
    }
    if !discard_settled(&root, request, &paths, trusted)? {
        return Err(io::Error::other(DISCARD_INCOMPLETE_ERROR));
    }
    root.validate()?;
    Ok(GitDiscardReceipt {
        relative_path: request.relative_path.clone(),
        action: if plan.restore.is_some() {
            GitDiscardAction::Restored
        } else {
            GitDiscardAction::Deleted
        },
    })
}

fn prepare(root: &Path, request: &GitDiscardFile, trusted: bool) -> io::Result<Prepared> {
    let paths = request_paths(request)?;
    if request.expected_status == GitChangeStatus::Conflicted {
        return Err(invalid(DISCARD_CONFLICT_ERROR));
    }
    let root = PinnedRoot::open_top_level(root, trusted, DISCARD_ROOT_ERROR)?;
    refuse_submodules(&root, &paths, trusted)?;
    revalidate(&root, request, &paths, trusted)?;
    let plan = DiscardPlan::for_request(request);
    require_paths_in_place(&root, &plan)?;
    let fingerprint = fingerprint(&root, &paths, trusted)?;
    Ok(Prepared {
        root,
        paths,
        plan,
        fingerprint,
    })
}

fn request_paths(request: &GitDiscardFile) -> io::Result<Vec<String>> {
    let mut paths = vec![repository_file_path(&request.relative_path)?];
    if let Some(old) = request.old_relative_path.as_deref() {
        let old = repository_file_path(old)?;
        if old == paths[0] {
            return Err(invalid("A renamed file must have two different paths."));
        }
        paths.push(old);
    }
    Ok(paths)
}

fn run(root: &PinnedRoot, args: &[&str], trusted: bool) -> io::Result<()> {
    root.run(args, trusted, COMMAND_OUTPUT_BYTES)
        .map(|_| ())
        .map_err(command_error)
}

pub(super) fn command_error(error: CommandError) -> io::Error {
    io::Error::other(error.into_message())
}

pub(super) fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_string())
}

#[cfg(test)]
#[path = "file_discard_tests.rs"]
mod tests;
