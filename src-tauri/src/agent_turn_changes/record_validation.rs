use super::{snapshot, types::*};
use std::collections::HashSet;
pub(super) fn validate_record(
    record: &Record,
    root: &RootIdentity,
    turn_id: &str,
) -> Result<(), String> {
    if record.version == 2 {
        return validate_checkpoint_record(record, root, turn_id);
    }
    if record.checkpoints.is_some()
        || record.version != 1
        || &record.root != root
        || record.turn_id != turn_id
        || record.summary.turn_id != turn_id
    {
        return Err("Saved turn changes belong to a different workspace or turn.".into());
    }
    if record.before.len() > 10000
        || record
            .after
            .as_ref()
            .is_some_and(|after| after.len() > 10000)
        || record.summary.files.len() > MAX_CHANGED_FILES
    {
        return Err("Saved turn changes exceed the supported bounds.".into());
    }
    if record
        .summary
        .reason
        .as_ref()
        .is_some_and(|reason| reason.len() > 1024)
        || (record.summary.state == ChangesState::Ready
            && (!record.finished || record.after.is_none()))
        || (record.summary.state == ChangesState::Unavailable && !record.summary.files.is_empty())
        || record.summary.state == ChangesState::Unsupported
    {
        return Err("Saved turn changes contain invalid summary data.".into());
    }
    if record.summary.state == ChangesState::Ready {
        let after = record
            .after
            .as_ref()
            .ok_or("Saved turn changes have no completion snapshot.")?;
        let paths: std::collections::BTreeSet<_> =
            record.before.keys().chain(after.keys()).collect();
        let changed: Vec<_> =
            paths
                .into_iter()
                .filter(|path| {
                    !record.before.get(*path).zip(after.get(*path)).is_some_and(
                        |(before, after)| {
                            before.digest == after.digest
                                && before.executable == after.executable
                                && before.unavailable == after.unavailable
                        },
                    )
                })
                .collect();
        if record.summary.truncated != (changed.len() > MAX_CHANGED_FILES)
            || !record
                .summary
                .files
                .iter()
                .map(|file| &file.relative_path)
                .eq(changed.into_iter().take(MAX_CHANGED_FILES))
        {
            return Err("Saved turn changes do not match their frozen snapshots.".into());
        }
    }
    let mut seen = HashSet::new();
    for file in &record.summary.files {
        let after = record
            .after
            .as_ref()
            .and_then(|after| after.get(&file.relative_path));
        let before = record.before.get(&file.relative_path);
        if !snapshot::valid_relative(&file.relative_path)
            || file.old_relative_path.is_some()
            || !seen.insert(&file.relative_path)
            || (before.is_none() && after.is_none())
            || before.zip(after).is_some_and(|(before, after)| {
                before.digest == after.digest
                    && before.executable == after.executable
                    && before.unavailable == after.unavailable
            })
            || file.added_lines.is_some()
                != before
                    .into_iter()
                    .chain(after)
                    .all(|entry| entry.unavailable.is_none())
            || [file.added_lines, file.deleted_lines]
                .into_iter()
                .flatten()
                .any(|count| count > 9_007_199_254_740_991)
            || file.added_lines.is_some() != file.deleted_lines.is_some()
            || matches!(file.status, ChangeStatus::Added) != before.is_none()
            || matches!(file.status, ChangeStatus::Deleted) != after.is_none()
        {
            return Err("Saved turn changes contain invalid file summary data.".into());
        }
    }
    for (path, entry) in record
        .before
        .iter()
        .chain(record.after.iter().flat_map(|after| after.iter()))
    {
        if entry.digest.len() != 64
            || !entry.digest.bytes().all(|b| b.is_ascii_hexdigit())
            || !snapshot::valid_relative(path)
            || entry
                .text
                .as_ref()
                .is_some_and(|text| text.len() > MAX_FILE_BYTES)
            || (entry.text.is_some() == entry.unavailable.is_some())
        {
            return Err("Saved turn changes contain invalid file data.".into());
        }
    }
    Ok(())
}
fn validate_checkpoint_record(
    record: &Record,
    root: &RootIdentity,
    turn_id: &str,
) -> Result<(), String> {
    if &record.root != root || record.turn_id != turn_id || record.summary.turn_id != turn_id {
        return Err("Saved turn changes belong to a different workspace or turn.".into());
    }
    let checkpoints = record
        .checkpoints
        .as_ref()
        .ok_or("Saved turn checkpoint metadata is missing.")?;
    if !record.before.is_empty()
        || record.after.is_some()
        || record.summary.files.len() > MAX_CHANGED_FILES
        || record
            .summary
            .reason
            .as_ref()
            .is_some_and(|reason| reason.len() > 1024)
        || (record.summary.state == ChangesState::Ready
            && (!record.finished || checkpoints.before.is_none() || checkpoints.after.is_none()))
        || (record.summary.state == ChangesState::Unavailable
            && (!record.summary.files.is_empty() || record.summary.truncated))
        || record.summary.state == ChangesState::Unsupported
    {
        return Err("Saved turn changes contain invalid checkpoint data.".into());
    }
    let owner =
        snapshot::digest(format!("{}:{}:{}", root.path, root.device, root.inode).as_bytes());
    let turn = snapshot::digest(turn_id.as_bytes());
    for (phase, checkpoint) in [
        ("before", &checkpoints.before),
        ("after", &checkpoints.after),
    ] {
        if let Some(checkpoint) = checkpoint {
            if checkpoint.bytes > MAX_READ_BYTES as u64
                || checkpoint.git.path.len() > 4096
                || checkpoint.common.path.len() > 4096
                || !std::path::Path::new(&checkpoint.git.path).is_absolute()
                || !std::path::Path::new(&checkpoint.common.path).is_absolute()
                || checkpoint.reference != format!("refs/codevo/checkpoints/{owner}/{turn}/{phase}")
                || ![40, 64].contains(&checkpoint.tree.len())
                || !checkpoint.tree.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err("Saved turn changes contain invalid checkpoint identity.".into());
            }
        }
    }
    let mut seen = HashSet::new();
    for file in &record.summary.files {
        if !snapshot::valid_relative(&file.relative_path)
            || file.old_relative_path.is_some()
            || !seen.insert(&file.relative_path)
            || file.added_lines.is_some() != file.deleted_lines.is_some()
            || [file.added_lines, file.deleted_lines]
                .into_iter()
                .flatten()
                .any(|count| count > 9_007_199_254_740_991)
        {
            return Err("Saved turn changes contain invalid file summary data.".into());
        }
    }
    Ok(())
}
