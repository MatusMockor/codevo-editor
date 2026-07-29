use super::{
    cleanup_owned_entry, copy_metadata, create_unique_file, open_parent, open_regular_at, read_all,
    regular_unlinked_stat, rename_swap, revision, run_test_hook, same_entry_snapshot,
    same_identity, split_path, stat_at, sync_dir, CommandFailure, FileRevision, TempCleanup,
};
use crate::workspace_registry::{WorkspaceId, WorkspaceRegistry};
use std::{ffi::CStr, fs::File, io::Write, os::fd::AsRawFd, path::Path};

pub(super) fn save_text(
    registry: &WorkspaceRegistry,
    id: &WorkspaceId,
    path: &Path,
    content: &str,
    expected: &FileRevision,
) -> Result<FileRevision, CommandFailure> {
    let _operation = registry.lock_operations()?;
    let root = registry.clone_root(id)?;
    let (parent_path, name) = split_path(path)?;
    let parent = open_parent(root.as_raw_fd(), parent_path)?;
    let target = open_regular_at(parent.as_raw_fd(), &name, libc::O_RDONLY)?;
    let original = regular_unlinked_stat(target.as_raw_fd())?;
    let original_bytes = read_all(&mut &target)?;
    if revision(&original, &original_bytes) != *expected {
        return Err(CommandFailure::Conflict(
            "file changed since it was read".into(),
        ));
    }
    drop(original_bytes);

    let (mut staged, staged_name) =
        create_unique_file(parent.as_raw_fd(), &name, original.st_mode as libc::mode_t)?;
    let staged_identity = regular_unlinked_stat(staged.as_raw_fd())?;
    let mut cleanup = TempCleanup {
        parent: parent.as_raw_fd(),
        name: staged_name.clone(),
        expected: staged_identity,
        armed: true,
    };
    run_test_hook(
        "save-after-temp-create",
        parent.as_raw_fd(),
        &name,
        &staged_name,
    );
    let preparation = (|| -> Result<(), CommandFailure> {
        staged.write_all(content.as_bytes())?;
        copy_metadata(target.as_raw_fd(), staged.as_raw_fd())?;
        staged.sync_all()?;
        let current = stat_at(parent.as_raw_fd(), &name)?;
        if !same_identity(&original, &current) {
            return Err(CommandFailure::Conflict(
                "file changed while it was being saved".into(),
            ));
        }
        let staged_name_stat = stat_at(parent.as_raw_fd(), &staged_name)?;
        if !same_identity(&staged_identity, &staged_name_stat) {
            return Err(CommandFailure::Conflict(
                "temporary save file changed before the atomic swap".into(),
            ));
        }
        Ok(())
    })();
    if let Err(failure) = preparation {
        if let Err(message) = cleanup.finish_before_return() {
            return Err(CommandFailure::Partial(message, None));
        }
        return Err(failure);
    }
    if let Err(error) = rename_swap(parent.as_raw_fd(), &staged_name, &name) {
        if let Err(message) = cleanup.finish_before_return() {
            return Err(CommandFailure::Partial(message, None));
        }
        return Err(error.into());
    }
    let saved = regular_unlinked_stat(staged.as_raw_fd()).map_err(|error| {
        cleanup.armed = false;
        CommandFailure::Partial(
            format!("file was swapped, but the staged capability could not be validated: {error}"),
            None,
        )
    })?;
    let saved_revision = revision(&saved, content.as_bytes());
    run_test_hook("save-after-swap", parent.as_raw_fd(), &name, &staged_name);
    let displaced = stat_at(parent.as_raw_fd(), &staged_name).map_err(|error| {
        cleanup.armed = false;
        CommandFailure::Partial(
            format!("file was swapped, but the displaced version could not be inspected: {error}"),
            Some(saved_revision.clone()),
        )
    })?;
    let displaced_file = open_regular_at(parent.as_raw_fd(), &staged_name, libc::O_RDONLY)
        .map_err(|error| {
            cleanup.armed = false;
            CommandFailure::Partial(
                format!("file was swapped, but the displaced version could not be opened: {error}"),
                Some(saved_revision.clone()),
            )
        })?;
    let displaced_bytes = read_all(&mut &displaced_file).map_err(|error| {
        cleanup.armed = false;
        CommandFailure::Partial(
            format!("file was swapped, but the displaced version could not be read: {error}"),
            Some(saved_revision.clone()),
        )
    })?;
    if !same_identity(&original, &displaced) || revision(&displaced, &displaced_bytes) != *expected
    {
        return rollback_conflicted_swap(
            &parent,
            &name,
            &staged_name,
            &original,
            &saved,
            expected,
            &saved_revision,
            &mut cleanup,
        );
    }
    drop(displaced_bytes);
    drop(displaced_file);
    settle_committed_swap(
        &parent,
        &name,
        &staged_name,
        &original,
        &saved,
        saved_revision,
        cleanup,
    )
}

#[allow(clippy::too_many_arguments)]
fn rollback_conflicted_swap(
    parent: &File,
    name: &CStr,
    staged_name: &CStr,
    original: &libc::stat,
    saved: &libc::stat,
    expected: &FileRevision,
    saved_revision: &FileRevision,
    cleanup: &mut TempCleanup,
) -> Result<FileRevision, CommandFailure> {
    let current_target = stat_at(parent.as_raw_fd(), name);
    let current_displaced = stat_at(parent.as_raw_fd(), staged_name);
    let target_revision_matches = open_regular_at(parent.as_raw_fd(), name, libc::O_RDONLY)
        .and_then(|file| {
            let stat = regular_unlinked_stat(file.as_raw_fd())?;
            let bytes = read_all(&mut &file)?;
            Ok(revision(&stat, &bytes) == *saved_revision)
        })
        .unwrap_or(false);
    let displaced_revision_matches =
        open_regular_at(parent.as_raw_fd(), staged_name, libc::O_RDONLY)
            .and_then(|file| {
                let stat = regular_unlinked_stat(file.as_raw_fd())?;
                let bytes = read_all(&mut &file)?;
                Ok(revision(&stat, &bytes) == *expected)
            })
            .unwrap_or(false);
    let safe_to_rollback = current_target
        .as_ref()
        .is_ok_and(|current| same_identity(saved, current))
        && current_displaced
            .as_ref()
            .is_ok_and(|current| same_identity(original, current))
        && target_revision_matches
        && displaced_revision_matches;
    if !safe_to_rollback {
        cleanup.armed = false;
        return Err(CommandFailure::Partial(
            "save race was detected and rollback was unsafe; all reachable versions were retained"
                .into(),
            None,
        ));
    }
    if let Err(error) = rename_swap(parent.as_raw_fd(), staged_name, name) {
        cleanup.armed = false;
        return Err(CommandFailure::Partial(
            format!(
                "save race was detected but rollback failed; both versions were retained: {error}"
            ),
            None,
        ));
    }
    let restored = stat_at(parent.as_raw_fd(), name).map_err(|error| {
        cleanup.armed = false;
        CommandFailure::Partial(
            format!(
                "save rollback completed, but the restored target could not be validated: {error}"
            ),
            None,
        )
    })?;
    let replacement = stat_at(parent.as_raw_fd(), staged_name).map_err(|error| {
        cleanup.armed = false;
        CommandFailure::Partial(
            format!("save rollback completed, but the replacement could not be validated: {error}"),
            None,
        )
    })?;
    if !same_identity(original, &restored) || !same_identity(saved, &replacement) {
        cleanup.armed = false;
        return Err(CommandFailure::Partial(
            "save rollback completed with unexpected identities; versions were retained".into(),
            None,
        ));
    }
    cleanup_owned_entry(
        parent.as_raw_fd(),
        staged_name,
        saved,
        0,
        "save-rollback-before-cleanup-isolation",
    )
    .map_err(|message| {
        cleanup.armed = false;
        CommandFailure::Partial(message, None)
    })?;
    cleanup.armed = false;
    if let Err(error) = sync_dir(parent) {
        return Err(CommandFailure::Partial(
            format!(
                "save was rolled back and cleaned up, but its directory could not be synced: {error}"
            ),
            None,
        ));
    }
    Err(CommandFailure::Conflict(
        "file changed during the atomic save; replacement was rolled back".into(),
    ))
}

fn settle_committed_swap(
    parent: &File,
    name: &CStr,
    staged_name: &CStr,
    original: &libc::stat,
    saved: &libc::stat,
    saved_revision: FileRevision,
    mut cleanup: TempCleanup,
) -> Result<FileRevision, CommandFailure> {
    run_test_hook(
        "save-before-target-revalidation",
        parent.as_raw_fd(),
        name,
        staged_name,
    );
    let live_target = stat_at(parent.as_raw_fd(), name).map_err(|error| {
        cleanup.armed = false;
        CommandFailure::Partial(
            format!("file was replaced, but its live target could not be revalidated: {error}"),
            Some(saved_revision.clone()),
        )
    })?;
    if !same_entry_snapshot(saved, &live_target) {
        cleanup.armed = false;
        return Err(CommandFailure::Partial(
            "save target changed after the atomic swap; reachable versions were retained".into(),
            Some(saved_revision),
        ));
    }
    cleanup_owned_entry(
        parent.as_raw_fd(),
        staged_name,
        original,
        0,
        "save-before-cleanup-isolation",
    )
    .map_err(|message| {
        cleanup.armed = false;
        CommandFailure::Partial(message, Some(saved_revision.clone()))
    })?;
    cleanup.armed = false;
    if unsafe { libc::fsync(parent.as_raw_fd()) } != 0 {
        return Err(CommandFailure::Partial(
            "file was replaced but its directory could not be synced".into(),
            Some(saved_revision),
        ));
    }
    Ok(saved_revision)
}
