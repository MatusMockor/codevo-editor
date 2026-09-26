pub(crate) use super::amend_index::{GitAmendFile, GitAmendFileAction};
use super::{
    amend_index::rewrite_head,
    bounded_process::CommandError,
    git_output_vec,
    pinned_root::{repository_file_path, PinnedRoot},
};
use serde::Serialize;
use std::{io, path::Path};

pub(crate) const MAX_AMEND_MESSAGE_BYTES: usize = 4 * 1024;
pub(crate) const MAX_AMEND_CHANGES: usize = 5_000;
pub(crate) const AMEND_NO_COMMIT_ERROR: &str = "There is no commit to amend yet.";
pub(crate) const AMEND_PUSHED_ERROR: &str =
    "The last commit is already pushed. Amending it would rewrite published history.";
pub(crate) const AMEND_HEAD_MOVED_ERROR: &str =
    "The last commit changed since you started amending. Turn off Amend and try again.";
pub(crate) const AMEND_OPERATION_IN_PROGRESS_ERROR: &str =
    "A merge, rebase, cherry-pick or revert is in progress. Finish or abort it before amending.";
const OPERATION_MARKERS: [&str; 5] = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
];
const AMEND_ROOT_ERROR: &str = "Select the repository root before amending.";
const HEAD_LOOKUP_BYTES: usize = 256;
const REMOTE_LOOKUP_BYTES: usize = 4 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum GitAmendCandidate {
    #[serde(rename_all = "camelCase")]
    Ready {
        head_sha: String,
        message: String,
    },
    NoCommit,
    OperationInProgress,
    #[serde(rename_all = "camelCase")]
    Pushed {
        head_sha: String,
    },
    #[serde(rename_all = "camelCase")]
    MessageTooLarge {
        head_sha: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitAmendReceipt {
    pub(crate) head_sha: String,
    pub(crate) index_synced: bool,
}

enum HeadState {
    NoCommit,
    Local(String),
    Pushed(String),
}

pub(crate) fn amend_candidate(root: &Path, trusted: bool) -> io::Result<GitAmendCandidate> {
    let root = PinnedRoot::open_top_level(root, trusted, AMEND_ROOT_ERROR)?;
    if operation_in_progress(&root, trusted)? {
        return Ok(GitAmendCandidate::OperationInProgress);
    }
    let head = match head_state(&root, trusted)? {
        HeadState::NoCommit => return Ok(GitAmendCandidate::NoCommit),
        HeadState::Pushed(head_sha) => return Ok(GitAmendCandidate::Pushed { head_sha }),
        HeadState::Local(head_sha) => head_sha,
    };
    let (raw, capped) = root
        .run_prefix(
            &["log", "-1", "--format=%B", &head, "--"],
            trusted,
            MAX_AMEND_MESSAGE_BYTES + 2,
        )
        .map_err(command_error)?;
    if capped {
        return Ok(GitAmendCandidate::MessageTooLarge { head_sha: head });
    }
    let Ok(message) = String::from_utf8(raw) else {
        return Ok(GitAmendCandidate::MessageTooLarge { head_sha: head });
    };
    let message = message.trim_end().to_string();
    if message.len() > MAX_AMEND_MESSAGE_BYTES {
        return Ok(GitAmendCandidate::MessageTooLarge { head_sha: head });
    }
    root.validate()?;
    Ok(GitAmendCandidate::Ready {
        head_sha: head,
        message,
    })
}

pub(crate) fn amend_head(
    root: &Path,
    expected_head: &str,
    message: &str,
    files: &[GitAmendFile],
    trusted: bool,
) -> io::Result<GitAmendReceipt> {
    let expected_head = object_id(expected_head)?;
    let message = amend_message(message)?;
    let files = selected_files(files)?;
    let root = PinnedRoot::open_top_level(root, trusted, AMEND_ROOT_ERROR)?;
    if operation_in_progress(&root, trusted)? {
        return Err(invalid(AMEND_OPERATION_IN_PROGRESS_ERROR));
    }
    match head_state(&root, trusted)? {
        HeadState::NoCommit => return Err(invalid(AMEND_NO_COMMIT_ERROR)),
        HeadState::Pushed(_) => return Err(denied(AMEND_PUSHED_ERROR)),
        HeadState::Local(head) if head != expected_head => {
            return Err(invalid(AMEND_HEAD_MOVED_ERROR))
        }
        HeadState::Local(_) => {}
    }
    root.validate()?;
    let outcome = rewrite_head(&root, &expected_head, message, &files, trusted)
        .map_err(|error| moved_head_error(&root, &expected_head, trusted, error))?;
    let head = current_head(&root, trusted)?.ok_or_else(|| invalid(AMEND_NO_COMMIT_ERROR))?;
    root.validate()?;
    Ok(GitAmendReceipt {
        head_sha: head,
        index_synced: outcome.index_synced,
    })
}

pub(super) fn refuse_amend_of_pushed_head(root: &Path, trusted: bool) -> io::Result<()> {
    let head = match git_output_vec(
        root,
        vec!["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        trusted,
    ) {
        Ok(head) => head.trim().to_string(),
        Err(_) => return Ok(()),
    };
    let contains = format!("--contains={head}");
    let remotes = git_output_vec(
        root,
        vec![
            "for-each-ref",
            "--count=1",
            "--format=%(refname)",
            contains.as_str(),
            "refs/remotes/",
        ],
        trusted,
    )?;
    if remotes.trim().is_empty() {
        return Ok(());
    }
    Err(io::Error::new(
        io::ErrorKind::PermissionDenied,
        "cannot amend a pushed commit",
    ))
}

fn operation_in_progress(root: &PinnedRoot, trusted: bool) -> io::Result<bool> {
    let mut args = vec!["rev-parse"];
    for marker in OPERATION_MARKERS {
        args.push("--git-path");
        args.push(marker);
    }
    let output = root
        .run(&args, trusted, REMOTE_LOOKUP_BYTES)
        .map_err(command_error)?;
    let text = String::from_utf8(output)
        .map_err(|_| io::Error::other("Git returned non-UTF-8 output."))?;
    for line in text.lines().filter(|line| !line.is_empty()) {
        let marker = Path::new(line);
        let marker = if marker.is_absolute() {
            marker.to_path_buf()
        } else {
            root.path().join(marker)
        };
        match std::fs::symlink_metadata(&marker) {
            Ok(_) => return Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(false)
}

fn head_state(root: &PinnedRoot, trusted: bool) -> io::Result<HeadState> {
    let Some(head) = current_head(root, trusted)? else {
        return Ok(HeadState::NoCommit);
    };
    let contains = format!("--contains={head}");
    let remotes = root
        .run(
            &[
                "for-each-ref",
                "--count=1",
                "--format=%(refname)",
                &contains,
                "refs/remotes/",
            ],
            trusted,
            REMOTE_LOOKUP_BYTES,
        )
        .map_err(command_error)?;
    if remotes.iter().any(|byte| !byte.is_ascii_whitespace()) {
        return Ok(HeadState::Pushed(head));
    }
    Ok(HeadState::Local(head))
}

fn current_head(root: &PinnedRoot, trusted: bool) -> io::Result<Option<String>> {
    match root.run(
        &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
        trusted,
        HEAD_LOOKUP_BYTES,
    ) {
        Ok(output) => {
            let text = String::from_utf8(output)
                .map_err(|_| io::Error::other("Git returned non-UTF-8 output."))?;
            object_id(text.trim()).map(Some)
        }
        Err(CommandError::Failed(_)) => Ok(None),
        Err(error) => Err(command_error(error)),
    }
}

fn moved_head_error(
    root: &PinnedRoot,
    expected_head: &str,
    trusted: bool,
    error: io::Error,
) -> io::Error {
    match current_head(root, trusted) {
        Ok(Some(head)) if head != expected_head => invalid(AMEND_HEAD_MOVED_ERROR),
        _ => error,
    }
}

fn amend_message(message: &str) -> io::Result<&str> {
    let message = message.trim();
    if message.is_empty() {
        return Err(invalid("Enter a commit message to amend the last commit."));
    }
    if message.len() > MAX_AMEND_MESSAGE_BYTES || message.contains('\0') {
        return Err(invalid(
            "The commit message is too long or contains invalid characters.",
        ));
    }
    Ok(message)
}

fn selected_files(files: &[GitAmendFile]) -> io::Result<Vec<GitAmendFile>> {
    if files.len() > MAX_AMEND_CHANGES {
        return Err(invalid("Too many files are selected to amend at once."));
    }
    let mut selected: Vec<GitAmendFile> = Vec::with_capacity(files.len());
    for file in files {
        let relative_path = repository_file_path(&file.relative_path)?;
        match selected
            .iter_mut()
            .find(|existing| existing.relative_path == relative_path)
        {
            Some(existing) if file.action == GitAmendFileAction::StageWorktree => {
                existing.action = GitAmendFileAction::StageWorktree;
            }
            Some(_) => {}
            None => selected.push(GitAmendFile {
                relative_path,
                action: file.action,
            }),
        }
    }
    Ok(selected)
}

fn object_id(value: &str) -> io::Result<String> {
    let valid = matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if !valid {
        return Err(invalid("Git commit id is invalid."));
    }
    Ok(value.to_string())
}

fn command_error(error: CommandError) -> io::Error {
    io::Error::other(error.into_message())
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_string())
}

fn denied(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::PermissionDenied, message.to_string())
}

#[cfg(test)]
#[path = "head_amend_tests.rs"]
mod tests;
