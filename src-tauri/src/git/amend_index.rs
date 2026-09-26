use super::{
    bounded_process::CommandError,
    pinned_root::{EntryKind, GitInvocation, PinnedRoot},
    scratch_index::ScratchIndex,
};
use serde::Deserialize;
use std::{
    collections::{HashMap, HashSet},
    io,
    path::Path,
    time::{Duration, Instant},
};

pub(crate) const AMEND_CONFLICT_ERROR: &str =
    "Conflicted files cannot be added to the last commit. Resolve them first.";
pub(crate) const AMEND_NOT_A_FILE_ERROR: &str = "Only files can be added to the last commit.";
pub(crate) const AMEND_TIMEOUT_ERROR: &str =
    "Amending took too long and was cancelled. Nothing was changed.";
pub(crate) const AMEND_INDEX_TOO_LARGE_ERROR: &str =
    "The repository index is too large to amend from here.";
pub(crate) const AMEND_UNSELECTED_CHANGES_ERROR: &str =
    "Amending would also remove files you didn't select:";
pub(crate) const AMEND_NOTHING_CHANGED_ERROR: &str =
    "Git could not update the last commit. Nothing was changed.";
pub(crate) const AMEND_HEAD_MOVED_AFTER_UPDATE_ERROR: &str =
    "Git could not confirm the amend and the last commit changed in the meantime. Refresh and check the history.";
const UNSELECTED_LIST_LIMIT: usize = 10;
pub(crate) const AMEND_DEADLINE: Duration = Duration::from_secs(60);
const INDEX_OUTPUT_BYTES: usize = 64 * 1024;
const INDEX_LISTING_BYTES: usize = 128 * 1024 * 1024;
const TEXT_OUTPUT_BYTES: usize = 8 * 1024;
const REFLOG_SUBJECT_CHARS: usize = 72;
const INDEX_LOCK_RETRY_DELAYS_MS: [u64; 6] = [25, 50, 100, 200, 400, 0];

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum GitAmendFileAction {
    StageWorktree,
    StageDeletion,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct GitAmendFile {
    pub(crate) relative_path: String,
    pub(crate) action: GitAmendFileAction,
}

enum StagedEntry {
    Present { mode: String, object: String },
    Absent,
}

pub(super) struct AmendOutcome {
    pub(super) index_synced: bool,
}

pub(super) fn rewrite_head(
    root: &PinnedRoot,
    expected_head: &str,
    message: &str,
    files: &[GitAmendFile],
    trusted: bool,
) -> io::Result<AmendOutcome> {
    let deadline = Instant::now() + AMEND_DEADLINE;
    let (tree, entries) = if files.is_empty() {
        let tree_ref = format!("{expected_head}^{{tree}}");
        let tree = text(
            root,
            &["rev-parse", "--verify", &tree_ref],
            None,
            deadline,
            trusted,
        )?;
        (tree, Vec::new())
    } else {
        staged_tree(root, expected_head, files, deadline, trusted)?
    };
    let commit = commit_tree(root, expected_head, tree.trim(), message, deadline, trusted)?;
    root.validate()?;
    let reflog = format!("amend: {}", reflog_subject(message));
    let updated = run(
        root,
        &[
            "update-ref",
            "-m",
            &reflog,
            "HEAD",
            commit.trim(),
            expected_head,
        ],
        None,
        Some(deadline),
        trusted,
    );
    if updated.is_err() {
        return settle_uncertain_update(root, expected_head, commit.trim(), trusted);
    }
    if entries.is_empty() {
        return Ok(AmendOutcome { index_synced: true });
    }
    Ok(AmendOutcome {
        index_synced: sync_real_index(root, expected_head, &entries, trusted),
    })
}

fn staged_tree(
    root: &PinnedRoot,
    expected_head: &str,
    files: &[GitAmendFile],
    deadline: Instant,
    trusted: bool,
) -> io::Result<(String, Vec<(String, StagedEntry)>)> {
    let paths: Vec<&str> = files
        .iter()
        .map(|file| file.relative_path.as_str())
        .collect();
    refuse_conflicts(root, &paths, deadline, trusted)?;
    let mut additions = Vec::new();
    let mut removals = Vec::new();
    for file in files {
        match file.action {
            GitAmendFileAction::StageDeletion => removals.push(file.relative_path.as_str()),
            GitAmendFileAction::StageWorktree => match root.entry_kind(&file.relative_path)? {
                None => removals.push(file.relative_path.as_str()),
                Some(EntryKind::File | EntryKind::Symlink) => {
                    additions.push(file.relative_path.as_str())
                }
                Some(EntryKind::Directory | EntryKind::Other) => {
                    return Err(invalid(AMEND_NOT_A_FILE_ERROR))
                }
            },
        }
    }
    let tree_index = ScratchIndex::create(root, "amend-tree", trusted)?;
    let index = Some(tree_index.path());
    run(
        root,
        &["read-tree", expected_head],
        index,
        Some(deadline),
        trusted,
    )?;
    if !additions.is_empty() {
        invoke(
            root,
            &[
                "--literal-pathspecs",
                "add",
                "-A",
                "--pathspec-from-file=-",
                "--pathspec-file-nul",
            ],
            index,
            nul_list(&additions),
            deadline,
            trusted,
        )?;
    }
    if !removals.is_empty() {
        invoke(
            root,
            &["update-index", "-z", "--force-remove", "--stdin"],
            index,
            nul_list(&removals),
            deadline,
            trusted,
        )?;
    }
    refuse_unselected_changes(
        root,
        tree_index.path(),
        expected_head,
        &paths,
        deadline,
        trusted,
    )?;
    let entries = staged_entries(root, tree_index.path(), &paths, deadline, trusted)?;
    let tree = text(root, &["write-tree"], index, deadline, trusted)?;
    Ok((tree, entries))
}

fn settle_uncertain_update(
    root: &PinnedRoot,
    expected_head: &str,
    new_commit: &str,
    trusted: bool,
) -> io::Result<AmendOutcome> {
    let head = root
        .run(
            &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
            trusted,
            TEXT_OUTPUT_BYTES,
        )
        .map_err(command_error)?;
    let head = String::from_utf8_lossy(&head).trim().to_string();
    if head == new_commit {
        return Ok(AmendOutcome {
            index_synced: false,
        });
    }
    if head == expected_head {
        return Err(io::Error::other(AMEND_NOTHING_CHANGED_ERROR));
    }
    Err(io::Error::other(AMEND_HEAD_MOVED_AFTER_UPDATE_ERROR))
}

fn refuse_unselected_changes(
    root: &PinnedRoot,
    index: &Path,
    expected_head: &str,
    paths: &[&str],
    deadline: Instant,
    trusted: bool,
) -> io::Result<()> {
    let output = root
        .invoke(
            &[
                "diff-index",
                "--cached",
                "--name-only",
                "-z",
                expected_head,
                "--",
            ],
            trusted,
            INDEX_LISTING_BYTES,
            GitInvocation {
                index_file: Some(index),
                deadline: Some(deadline),
                ..GitInvocation::default()
            },
        )
        .map_err(listing_error)?;
    let wanted: HashSet<&str> = paths.iter().copied().collect();
    let unselected: Vec<String> = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
        .map(|record| String::from_utf8_lossy(record).to_string())
        .filter(|path| !wanted.contains(path.as_str()))
        .collect();
    if unselected.is_empty() {
        return Ok(());
    }
    let shown: Vec<&str> = unselected
        .iter()
        .take(UNSELECTED_LIST_LIMIT)
        .map(String::as_str)
        .collect();
    let more = unselected.len().saturating_sub(shown.len());
    let suffix = if more > 0 {
        format!(" and {more} more")
    } else {
        String::new()
    };
    Err(invalid(&format!(
        "{AMEND_UNSELECTED_CHANGES_ERROR} {}{suffix}.",
        shown.join(", ")
    )))
}

fn staged_entries(
    root: &PinnedRoot,
    index: &Path,
    paths: &[&str],
    deadline: Instant,
    trusted: bool,
) -> io::Result<Vec<(String, StagedEntry)>> {
    let listing = root
        .invoke(
            &["ls-files", "-s", "-z"],
            trusted,
            INDEX_LISTING_BYTES,
            GitInvocation {
                index_file: Some(index),
                deadline: Some(deadline),
                ..GitInvocation::default()
            },
        )
        .map_err(listing_error)?;
    let wanted: HashSet<&str> = paths.iter().copied().collect();
    let mut found: HashMap<String, StagedEntry> = HashMap::new();
    for record in listing
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty())
    {
        let text = std::str::from_utf8(record)
            .map_err(|_| io::Error::other("Git returned a non-UTF-8 index entry."))?;
        let Some((meta, path)) = text.split_once('\t') else {
            return Err(io::Error::other("Git returned a malformed index entry."));
        };
        if !wanted.contains(path) {
            continue;
        }
        found.insert(path.to_string(), parse_entry(meta)?);
    }
    Ok(paths
        .iter()
        .map(|path| {
            let entry = found.remove(*path).unwrap_or(StagedEntry::Absent);
            ((*path).to_string(), entry)
        })
        .collect())
}

fn parse_entry(meta: &str) -> io::Result<StagedEntry> {
    let mut fields = meta.split(' ');
    let (Some(mode), Some(object), Some("0"), None) =
        (fields.next(), fields.next(), fields.next(), fields.next())
    else {
        return Err(invalid(AMEND_CONFLICT_ERROR));
    };
    let well_formed = mode.len() == 6
        && mode.bytes().all(|byte| byte.is_ascii_digit())
        && matches!(object.len(), 40 | 64)
        && object.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !well_formed {
        return Err(io::Error::other("Git returned a malformed index entry."));
    }
    Ok(StagedEntry::Present {
        mode: mode.to_string(),
        object: object.to_string(),
    })
}

fn commit_tree(
    root: &PinnedRoot,
    expected_head: &str,
    tree: &str,
    message: &str,
    deadline: Instant,
    trusted: bool,
) -> io::Result<String> {
    let parents = text(
        root,
        &["rev-list", "--parents", "-n", "1", expected_head, "--"],
        None,
        deadline,
        trusted,
    )?;
    let author = text(
        root,
        &[
            "show",
            "-s",
            "--format=%an%x1f%ae%x1f%aI",
            expected_head,
            "--",
        ],
        None,
        deadline,
        trusted,
    )?;
    let mut fields = author.trim_end().splitn(3, '\x1f');
    let (Some(name), Some(email), Some(date)) = (fields.next(), fields.next(), fields.next())
    else {
        return Err(io::Error::other("Commit author metadata is incomplete."));
    };
    let mut args = vec!["commit-tree", tree];
    for parent in parents.split_whitespace().skip(1) {
        args.push("-p");
        args.push(parent);
    }
    args.extend(["-F", "-"]);
    let env = [
        ("GIT_AUTHOR_NAME", name),
        ("GIT_AUTHOR_EMAIL", email),
        ("GIT_AUTHOR_DATE", date),
    ];
    let output = root
        .invoke(
            &args,
            trusted,
            TEXT_OUTPUT_BYTES,
            GitInvocation {
                env: &env,
                input: Some(format!("{message}\n").into_bytes()),
                deadline: Some(deadline),
                ..GitInvocation::default()
            },
        )
        .map_err(command_error)?;
    String::from_utf8(output).map_err(|_| io::Error::other("Git returned non-UTF-8 output."))
}

fn sync_real_index(
    root: &PinnedRoot,
    expected_head: &str,
    entries: &[(String, StagedEntry)],
    trusted: bool,
) -> bool {
    let input = index_info(entries, expected_head.len());
    for delay in INDEX_LOCK_RETRY_DELAYS_MS {
        let result = root.invoke(
            &["update-index", "-z", "--index-info"],
            trusted,
            INDEX_OUTPUT_BYTES,
            GitInvocation {
                input: Some(input.clone()),
                ..GitInvocation::default()
            },
        );
        match result {
            Ok(_) => return true,
            Err(CommandError::Failed(message)) if message.contains("index.lock") => {
                std::thread::sleep(Duration::from_millis(delay));
            }
            Err(_) => return false,
        }
    }
    false
}

fn index_info(entries: &[(String, StagedEntry)], object_length: usize) -> Vec<u8> {
    let mut input = Vec::new();
    for (path, entry) in entries {
        match entry {
            StagedEntry::Present { mode, object } => {
                input.extend_from_slice(format!("{mode} {object}\t{path}").as_bytes());
            }
            StagedEntry::Absent => {
                let zeros = "0".repeat(object_length);
                input.extend_from_slice(format!("0 {zeros}\t{path}").as_bytes());
            }
        }
        input.push(0);
    }
    input
}

fn refuse_conflicts(
    root: &PinnedRoot,
    paths: &[&str],
    deadline: Instant,
    trusted: bool,
) -> io::Result<()> {
    let output = root
        .invoke(
            &["ls-files", "-u", "-z"],
            trusted,
            INDEX_LISTING_BYTES,
            GitInvocation {
                deadline: Some(deadline),
                ..GitInvocation::default()
            },
        )
        .map_err(listing_error)?;
    let wanted: HashSet<&str> = paths.iter().copied().collect();
    let conflicted = output
        .split(|byte| *byte == 0)
        .filter_map(|record| std::str::from_utf8(record).ok())
        .filter_map(|record| record.split_once('\t').map(|(_, path)| path))
        .any(|path| wanted.contains(path));
    if conflicted {
        return Err(invalid(AMEND_CONFLICT_ERROR));
    }
    Ok(())
}

fn reflog_subject(message: &str) -> String {
    message
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(REFLOG_SUBJECT_CHARS)
        .collect()
}

fn nul_list(paths: &[&str]) -> Vec<u8> {
    let mut input = Vec::new();
    for path in paths {
        input.extend_from_slice(path.as_bytes());
        input.push(0);
    }
    input
}

fn invoke(
    root: &PinnedRoot,
    args: &[&str],
    index: Option<&Path>,
    input: Vec<u8>,
    deadline: Instant,
    trusted: bool,
) -> io::Result<()> {
    root.invoke(
        args,
        trusted,
        INDEX_OUTPUT_BYTES,
        GitInvocation {
            index_file: index,
            input: Some(input),
            deadline: Some(deadline),
            ..GitInvocation::default()
        },
    )
    .map(|_| ())
    .map_err(command_error)
}

fn run(
    root: &PinnedRoot,
    args: &[&str],
    index: Option<&Path>,
    deadline: Option<Instant>,
    trusted: bool,
) -> io::Result<()> {
    root.invoke(
        args,
        trusted,
        INDEX_OUTPUT_BYTES,
        GitInvocation {
            index_file: index,
            deadline,
            ..GitInvocation::default()
        },
    )
    .map(|_| ())
    .map_err(command_error)
}

fn text(
    root: &PinnedRoot,
    args: &[&str],
    index: Option<&Path>,
    deadline: Instant,
    trusted: bool,
) -> io::Result<String> {
    let output = root
        .invoke(
            args,
            trusted,
            TEXT_OUTPUT_BYTES,
            GitInvocation {
                index_file: index,
                deadline: Some(deadline),
                ..GitInvocation::default()
            },
        )
        .map_err(command_error)?;
    String::from_utf8(output).map_err(|_| io::Error::other("Git returned non-UTF-8 output."))
}

fn listing_error(error: CommandError) -> io::Error {
    match error {
        CommandError::Io(message) if message.contains("exceed") => {
            io::Error::other(AMEND_INDEX_TOO_LARGE_ERROR)
        }
        other => command_error(other),
    }
}

fn command_error(error: CommandError) -> io::Error {
    if let CommandError::TimedOut(_) = error {
        return io::Error::other(AMEND_TIMEOUT_ERROR);
    }
    io::Error::other(error.into_message())
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.to_string())
}
