use super::{
    checkpoint::{output, tree, verify_checkpoint, TreeEntry},
    git_authority::Context,
    git_process, snapshot, storage,
    types::*,
};
fn unavailable(entry: Option<&TreeEntry>) -> Option<DiffUnavailableReason> {
    entry.and_then(|entry| {
        if entry.mode == "120000" {
            Some(DiffUnavailableReason::Binary)
        } else if entry.size > MAX_FILE_BYTES {
            Some(DiffUnavailableReason::Large)
        } else {
            None
        }
    })
}
pub(super) fn summary(
    identity: &RootIdentity,
    before: &Checkpoint,
    after: &Checkpoint,
    turn_id: &str,
) -> Result<TurnChangesSummary, String> {
    let context = Context::new(identity)?;
    let identity = &context;
    verify_checkpoint(identity, before)?;
    verify_checkpoint(identity, after)?;
    let old = tree(identity, before)?;
    let new = tree(identity, after)?;
    let bytes = output(
        identity,
        &[
            "diff",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            "--numstat",
            "--text",
            "--diff-algorithm=myers",
            "--no-indent-heuristic",
            "-O/dev/null",
            "-z",
            &before.tree,
            &after.tree,
            "--",
        ],
    )?;
    let mut files = Vec::new();
    let mut truncated = false;
    for record in bytes.split(|b| *b == 0).filter(|r| !r.is_empty()) {
        let text = std::str::from_utf8(record).map_err(|_| "Invalid checkpoint diff.")?;
        let fields: Vec<_> = text.splitn(3, '\t').collect();
        if fields.len() != 3 || !snapshot::valid_relative(fields[2]) {
            return Err("Invalid checkpoint diff path.".into());
        }
        let path = fields[2];
        let a = old.get(path);
        let b = new.get(path);
        if a.is_none() && b.is_none() {
            return Err("Unknown checkpoint diff path.".into());
        }
        if files.len() == MAX_CHANGED_FILES {
            truncated = true;
            break;
        }
        let readable = unavailable(a).or_else(|| unavailable(b)).is_none()
            && fields[0] != "-"
            && fields[1] != "-";
        let count = |text: &str| {
            if readable {
                text.parse::<u64>()
                    .map(Some)
                    .map_err(|_| "Invalid checkpoint line count.".to_owned())
            } else {
                Ok(None)
            }
        };
        files.push(TurnChangedFile {
            relative_path: path.into(),
            old_relative_path: None,
            status: if a.is_none() {
                ChangeStatus::Added
            } else if b.is_none() {
                ChangeStatus::Deleted
            } else {
                ChangeStatus::Modified
            },
            added_lines: count(fields[0])?,
            deleted_lines: count(fields[1])?,
        });
    }
    mark_binary(identity, &old, &new, &mut files)?;
    Ok(TurnChangesSummary {
        turn_id: turn_id.into(),
        state: ChangesState::Ready,
        files,
        truncated,
        reason: truncated.then(|| "Some changed files exceed the display limit.".into()),
    })
}
pub(super) fn file_diff(
    identity: &RootIdentity,
    before: &Checkpoint,
    after: &Checkpoint,
    path: &str,
) -> Result<TurnFileDiff, String> {
    if !snapshot::valid_relative(path) {
        return Err("Invalid checkpoint file path.".into());
    }
    let context = Context::new(identity)?;
    let identity = &context;
    verify_checkpoint(identity, before)?;
    verify_checkpoint(identity, after)?;
    let old = tree(identity, before)?;
    let new = tree(identity, after)?;
    let a = old.get(path);
    let b = new.get(path);
    let mut reason = unavailable(a).or_else(|| unavailable(b));
    let mut read = |entry: Option<&TreeEntry>| -> Result<String, String> {
        let Some(entry) = entry else {
            return Ok(String::new());
        };
        if reason.is_some() {
            return Ok(String::new());
        }
        let bytes = output(identity, &["cat-file", "blob", &entry.object])?;
        if bytes.len() != entry.size {
            return Err("Checkpoint blob size changed.".into());
        }
        match String::from_utf8(bytes) {
            Ok(text) if !text.contains('\0') => Ok(text),
            _ => {
                reason = Some(DiffUnavailableReason::Binary);
                Ok(String::new())
            }
        }
    };
    let mut original = read(a)?;
    let mut modified = read(b)?;
    if reason.is_some() {
        original.clear();
        modified.clear();
    }
    Ok(TurnFileDiff {
        relative_path: path.into(),
        original: DiffSide {
            text: original,
            truncated: false,
        },
        modified: DiffSide {
            text: modified,
            truncated: false,
        },
        unavailable_reason: reason,
    })
}

fn mark_binary(
    context: &Context,
    old: &std::collections::BTreeMap<String, TreeEntry>,
    new: &std::collections::BTreeMap<String, TreeEntry>,
    files: &mut [TurnChangedFile],
) -> Result<(), String> {
    let mut objects = std::collections::BTreeMap::new();
    for file in files.iter().filter(|file| file.added_lines.is_some()) {
        for entry in old
            .get(&file.relative_path)
            .into_iter()
            .chain(new.get(&file.relative_path))
        {
            objects.insert(entry.object.clone(), entry.size);
        }
    }
    let entries: Vec<_> = objects.into_iter().collect();
    let parent = std::env::temp_dir()
        .canonicalize()
        .map_err(|_| "Temporary checkpoint storage is unavailable.")?;
    let temp = storage::TemporaryDirectory::new(&parent)?;
    let mut binary = std::collections::BTreeSet::new();
    let started = std::time::Instant::now();
    let mut cursor = 0;
    while cursor < entries.len() {
        if started.elapsed() > snapshot::TIME_LIMIT {
            return Err("Checkpoint comparison exceeded the time limit.".into());
        }
        let start = cursor;
        let mut batch_bytes = 0;
        while cursor < entries.len() && batch_bytes + entries[cursor].1 < 1024 * 1024 {
            batch_bytes += entries[cursor].1 + 128;
            cursor += 1;
        }
        let chunk = &entries[start..cursor];
        let input_name = format!("objects-{start}");
        let input = chunk
            .iter()
            .map(|(id, _)| format!("{id}\n"))
            .collect::<String>();
        temp.write_relative(std::path::Path::new(&input_name), input.as_bytes())?;
        temp.verify_identity()?;
        let mut command = context.command()?;
        command.arg("cat-file").arg("--batch");
        let bytes = git_process::run_input(command, temp.open_read(&input_name)?)?;
        context.verify()?;
        let mut remaining = bytes.as_slice();
        for (id, size) in chunk {
            let end = remaining
                .iter()
                .position(|byte| *byte == b'\n')
                .ok_or("Invalid checkpoint blob header.")?;
            if remaining[..end] != format!("{id} blob {size}").as_bytes()[..] {
                return Err("Invalid checkpoint blob response.".into());
            }
            remaining = &remaining[end + 1..];
            if remaining.len() < size + 1 || remaining[*size] != b'\n' {
                return Err("Incomplete checkpoint blob response.".into());
            }
            let data = &remaining[..*size];
            if data.contains(&0) || std::str::from_utf8(data).is_err() {
                binary.insert(id.clone());
            }
            remaining = &remaining[size + 1..];
        }
        if !remaining.is_empty() {
            return Err("Unexpected checkpoint blob response.".into());
        }
    }
    for file in files {
        if old
            .get(&file.relative_path)
            .into_iter()
            .chain(new.get(&file.relative_path))
            .any(|entry| binary.contains(&entry.object))
        {
            file.added_lines = None;
            file.deleted_lines = None;
        }
    }
    Ok(())
}
