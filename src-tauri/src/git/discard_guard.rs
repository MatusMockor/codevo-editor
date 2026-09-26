use super::{
    bounded_process::CommandError,
    file_discard::{
        command_error, invalid, DiscardPlan, GitDiscardFile, DISCARD_CLEAN_ERROR,
        DISCARD_CONFLICT_ERROR, DISCARD_PATH_BLOCKED_ERROR, DISCARD_STALE_ERROR,
        DISCARD_SUBMODULE_ERROR, DISCARD_UNTRACKED_OVERLAP_ERROR,
    },
    parse_porcelain_status,
    pinned_root::{EntryKind, PinnedRoot},
    GitChangeStatus, GitChangedFile,
};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read},
};

const STATUS_OUTPUT_BYTES: usize = 256 * 1024;
const INDEX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_HASHED_FILE_BYTES: u64 = 32 * 1024 * 1024;
const GITLINK_MODE: &str = "160000";

struct StatusSnapshot {
    changes: Vec<GitChangedFile>,
    ignored: Vec<String>,
}

pub(super) fn refuse_submodules(
    root: &PinnedRoot,
    paths: &[String],
    trusted: bool,
) -> io::Result<()> {
    let mut index_args = vec!["--literal-pathspecs", "ls-files", "-s", "-z", "--"];
    index_args.extend(paths.iter().map(String::as_str));
    let index = root
        .run(&index_args, trusted, INDEX_OUTPUT_BYTES)
        .map_err(command_error)?;
    let mut head_args = vec!["--literal-pathspecs", "ls-tree", "-z", "HEAD", "--"];
    head_args.extend(paths.iter().map(String::as_str));
    let head = match root.run(&head_args, trusted, INDEX_OUTPUT_BYTES) {
        Ok(output) => output,
        Err(CommandError::Failed(_)) => Vec::new(),
        Err(error) => return Err(command_error(error)),
    };
    let gitlink = index
        .split(|byte| *byte == 0)
        .chain(head.split(|byte| *byte == 0))
        .any(|record| record.starts_with(GITLINK_MODE.as_bytes()));
    if gitlink {
        return Err(invalid(DISCARD_SUBMODULE_ERROR));
    }
    Ok(())
}

pub(super) fn revalidate(
    root: &PinnedRoot,
    request: &GitDiscardFile,
    paths: &[String],
    trusted: bool,
) -> io::Result<()> {
    for path in paths {
        require_real_ancestors(root, path)?;
    }
    let snapshot = status_snapshot(root, paths, trusted)?;
    let related = |path: &str| paths.iter().any(|target| related_paths(path, target));
    let changes: Vec<&GitChangedFile> = snapshot
        .changes
        .iter()
        .filter(|entry| related(&entry.relative_path))
        .collect();
    if changes
        .iter()
        .any(|entry| entry.status == GitChangeStatus::Conflicted)
    {
        return Err(invalid(DISCARD_CONFLICT_ERROR));
    }
    let matching: Vec<&GitChangedFile> = changes
        .iter()
        .copied()
        .filter(|entry| entry.relative_path == request.relative_path)
        .collect();
    let Some(first) = matching.first() else {
        return Err(invalid(DISCARD_CLEAN_ERROR));
    };
    let untracked_expected = request.expected_status == GitChangeStatus::Untracked;
    let effective = if untracked_expected {
        matching
            .iter()
            .find(|entry| entry.status == GitChangeStatus::Untracked)
            .copied()
            .unwrap_or(first)
    } else {
        matching
            .iter()
            .filter(|entry| entry.status != GitChangeStatus::Untracked)
            .find(|entry| entry.is_staged)
            .or_else(|| {
                matching
                    .iter()
                    .find(|entry| entry.status != GitChangeStatus::Untracked)
            })
            .copied()
            .unwrap_or(first)
    };
    if effective.status != request.expected_status
        || effective.old_relative_path != request.old_relative_path
    {
        return Err(invalid(DISCARD_STALE_ERROR));
    }
    let overlapping = changes.iter().any(|entry| {
        entry.status == GitChangeStatus::Untracked
            && !(untracked_expected && entry.relative_path == request.relative_path)
    }) || snapshot.ignored.iter().any(|path| related(path));
    if overlapping {
        return Err(invalid(DISCARD_UNTRACKED_OVERLAP_ERROR));
    }
    let foreign = changes.iter().any(|entry| {
        let other_path = entry.relative_path != request.relative_path;
        let tracked_twin =
            untracked_expected && !other_path && entry.status != GitChangeStatus::Untracked;
        let foreign_rename = entry.old_relative_path.is_some()
            && entry.old_relative_path != request.old_relative_path;
        other_path || foreign_rename || (tracked_twin && entry.status != GitChangeStatus::Deleted)
    });
    if foreign {
        return Err(invalid(DISCARD_STALE_ERROR));
    }
    Ok(())
}

pub(super) fn require_paths_in_place(root: &PinnedRoot, plan: &DiscardPlan) -> io::Result<()> {
    if let Some(restore) = plan.restore.as_deref() {
        require_real_ancestors(root, restore)?;
        let allowed = match root.entry_kind(restore)? {
            None => true,
            Some(EntryKind::File | EntryKind::Symlink) => !plan.restore_must_be_absent,
            Some(EntryKind::Directory | EntryKind::Other) => false,
        };
        if !allowed {
            return Err(invalid(DISCARD_PATH_BLOCKED_ERROR));
        }
    }
    if let Some(remove) = plan.remove.as_deref() {
        require_real_ancestors(root, remove)?;
        if matches!(
            root.entry_kind(remove)?,
            Some(EntryKind::Directory | EntryKind::Other)
        ) {
            return Err(invalid(DISCARD_PATH_BLOCKED_ERROR));
        }
    }
    Ok(())
}

pub(super) fn fingerprint(
    root: &PinnedRoot,
    paths: &[String],
    trusted: bool,
) -> io::Result<String> {
    let mut hasher = Sha256::new();
    let mut index_args = vec!["--literal-pathspecs", "ls-files", "-s", "-z", "--"];
    index_args.extend(paths.iter().map(String::as_str));
    let index = root
        .run(&index_args, trusted, INDEX_OUTPUT_BYTES)
        .map_err(command_error)?;
    hasher.update(b"index\0");
    hasher.update(&index);
    for path in paths {
        hasher.update(path.as_bytes());
        hasher.update([0]);
        match root.entry_kind(path)? {
            None => hasher.update(b"absent"),
            Some(EntryKind::Symlink) => {
                hasher.update(b"symlink\0");
                let target = fs::read_link(root.path().join(path))?;
                hasher.update(target.as_os_str().as_encoded_bytes());
            }
            Some(EntryKind::File) => {
                hasher.update(b"file\0");
                hash_file(root, path, &mut hasher)?;
            }
            Some(EntryKind::Directory | EntryKind::Other) => {
                return Err(invalid(DISCARD_PATH_BLOCKED_ERROR))
            }
        }
        hasher.update([0]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub(super) fn discard_settled(
    root: &PinnedRoot,
    request: &GitDiscardFile,
    paths: &[String],
    trusted: bool,
) -> io::Result<bool> {
    let snapshot = status_snapshot(root, paths, trusted)?;
    if !snapshot.ignored.is_empty() {
        return Ok(false);
    }
    if request.expected_status != GitChangeStatus::Untracked {
        return Ok(snapshot.changes.is_empty());
    }
    Ok(snapshot
        .changes
        .iter()
        .all(|entry| entry.status != GitChangeStatus::Untracked))
}

fn status_snapshot(
    root: &PinnedRoot,
    pathspecs: &[String],
    trusted: bool,
) -> io::Result<StatusSnapshot> {
    let mut args = vec![
        "--literal-pathspecs",
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignored=matching",
        "--",
    ];
    args.extend(pathspecs.iter().map(String::as_str));
    let output = root
        .run(&args, trusted, STATUS_OUTPUT_BYTES)
        .map_err(command_error)?;
    let mut tracked = Vec::new();
    let mut ignored = Vec::new();
    let mut records = output
        .split(|byte| *byte == 0)
        .filter(|record| !record.is_empty());
    while let Some(record) = records.next() {
        if let Some(path) = record.strip_prefix(b"!! ") {
            ignored.push(trimmed(&String::from_utf8_lossy(path)).to_string());
            continue;
        }
        tracked.extend_from_slice(record);
        tracked.push(0);
        if record.len() > 2 && record[..2].contains(&b'R') {
            if let Some(old) = records.next() {
                tracked.extend_from_slice(old);
                tracked.push(0);
            }
        }
    }
    let mut changes = parse_porcelain_status(root.path(), &tracked)?;
    for change in &mut changes {
        change.relative_path = trimmed(&change.relative_path).to_string();
    }
    Ok(StatusSnapshot { changes, ignored })
}

fn require_real_ancestors(root: &PinnedRoot, path: &str) -> io::Result<()> {
    for ancestor in ancestors(path) {
        match root.entry_kind(ancestor)? {
            None => return Ok(()),
            Some(EntryKind::Directory) => {}
            Some(_) => return Err(invalid(DISCARD_PATH_BLOCKED_ERROR)),
        }
    }
    Ok(())
}

fn hash_file(root: &PinnedRoot, path: &str, hasher: &mut Sha256) -> io::Result<()> {
    let file = open_no_follow(root, path)?;
    let metadata = file.metadata()?;
    if metadata.len() > MAX_HASHED_FILE_BYTES {
        use std::os::unix::fs::MetadataExt;
        hasher.update(b"large\0");
        hasher.update(metadata.len().to_le_bytes());
        hasher.update(metadata.mtime().to_le_bytes());
        hasher.update(metadata.mtime_nsec().to_le_bytes());
        hasher.update(metadata.ctime().to_le_bytes());
        hasher.update(metadata.ctime_nsec().to_le_bytes());
        hasher.update(metadata.ino().to_le_bytes());
        hasher.update(metadata.dev().to_le_bytes());
        return Ok(());
    }
    let mut buffer = [0_u8; 64 * 1024];
    let mut reader = file.take(MAX_HASHED_FILE_BYTES + 1);
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        hasher.update(&buffer[..read]);
    }
}

fn open_no_follow(root: &PinnedRoot, path: &str) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(root.path().join(path))
}

fn ancestors(path: &str) -> impl Iterator<Item = &str> {
    path.match_indices('/')
        .map(move |(index, _)| &path[..index])
}

fn related_paths(entry: &str, target: &str) -> bool {
    entry == target || is_ancestor(entry, target) || is_ancestor(target, entry)
}

fn is_ancestor(ancestor: &str, path: &str) -> bool {
    path.len() > ancestor.len()
        && path.starts_with(ancestor)
        && path.as_bytes()[ancestor.len()] == b'/'
}

fn trimmed(path: &str) -> &str {
    path.strip_suffix('/').unwrap_or(path)
}
