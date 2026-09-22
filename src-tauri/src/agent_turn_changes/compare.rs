use super::{git_process, snapshot, storage, types::*};
use std::{collections::BTreeSet, path::Path};

pub(super) fn summary(
    base: &Path,
    record: &Record,
    after: &Snapshot,
) -> Result<TurnChangesSummary, String> {
    let paths: BTreeSet<_> = record.before.keys().chain(after.keys()).collect();
    let mut files = Vec::new();
    let mut truncated = false;
    let temporary = storage::TemporaryDirectory::new(base)?;
    let before_dir = temporary.0.join("before");
    let after_dir = temporary.0.join("after");
    temporary.verify_identity()?;
    storage::private_directory(&before_dir)?;
    storage::private_directory(&after_dir)?;
    for path in paths {
        let before = record.before.get(path);
        let next = after.get(path);
        if before.zip(next).is_some_and(|(a, b)| {
            a.digest == b.digest && a.executable == b.executable && a.unavailable == b.unavailable
        }) {
            continue;
        }
        if files.len() == MAX_CHANGED_FILES {
            truncated = true;
            break;
        }
        let readable = before
            .into_iter()
            .chain(next)
            .all(|entry| entry.unavailable.is_none());
        if readable {
            write_side(&temporary, "before", path, before)?;
            write_side(&temporary, "after", path, next)?;
        }
        files.push(TurnChangedFile {
            relative_path: path.clone(),
            old_relative_path: None,
            status: if before.is_none() {
                ChangeStatus::Added
            } else if next.is_none() {
                ChangeStatus::Deleted
            } else {
                ChangeStatus::Modified
            },
            added_lines: readable.then_some(0),
            deleted_lines: readable.then_some(0),
        });
    }
    temporary.verify_identity()?;
    let stats = git_process::numstat(&before_dir, &after_dir)?;
    temporary.verify_identity()?;
    for file in &mut files {
        if file.added_lines.is_some() {
            if let Some((added, deleted)) = stats.get(&file.relative_path) {
                file.added_lines = Some(*added);
                file.deleted_lines = Some(*deleted);
            }
        }
    }
    Ok(TurnChangesSummary {
        turn_id: record.turn_id.clone(),
        state: ChangesState::Ready,
        files,
        truncated,
        reason: truncated.then(|| "Some changed files exceed the display limit.".into()),
    })
}
fn write_side(
    temporary: &storage::TemporaryDirectory,
    side: &str,
    path: &str,
    entry: Option<&Entry>,
) -> Result<(), String> {
    if !snapshot::valid_relative(path) {
        return Err("Invalid saved file path.".into());
    }
    let Some(entry) = entry else {
        return Ok(());
    };
    temporary.write_relative(
        &Path::new(side).join(path),
        entry
            .text
            .as_deref()
            .ok_or("Saved file text is unavailable.")?
            .as_bytes(),
    )
}
