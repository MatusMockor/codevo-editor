use super::*;
use std::io::Write;

pub(super) fn prepare(
    provider: ExternalSessionProvider,
    session: &str,
    root: &str,
    cutoff: u64,
    cursor: Option<SourceCursor>,
    roots: &ExternalSessionHistoryRoots,
    directory: &Path,
) -> Result<SourceCursor, String> {
    if let Some(cursor) = &cursor {
        if cursor.copied_bytes == cursor.snapshot_bytes {
            return Ok(cursor.clone());
        }
    }
    let path = match provider {
        AgentCliInvocation::ClaudeCode => roots
            .claude_projects_directory
            .join(encode_claude_project_directory(root))
            .join(format!("{session}.jsonl")),
        AgentCliInvocation::CodexExec => {
            find_codex_session_file(&roots.codex_sessions_directory, session, current_epoch_ms())
                .ok_or_else(|| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?
        }
    };
    let mut source =
        open_history_file(&path).map_err(|_| EXTERNAL_SESSION_UNREADABLE_ERROR.to_string())?;
    let metadata = source.metadata().map_err(|_| SOURCE_CHANGED.to_string())?;
    let identity = source_identity(&metadata);
    let source_modified = modified(&metadata);
    if metadata.len() > 9_007_199_254_740_991 {
        return Err("The source session exceeds the supported import size.".into());
    }
    let initial = cursor.is_none();
    let mut cursor = cursor.unwrap_or_else(|| SourceCursor {
        identity: identity.clone(),
        source_modified: source_modified.clone(),
        snapshot_name: format!(
            "import-{:016x}.snapshot",
            hash(&format!("{provider:?}:{session}:{root}:{cutoff}"))
        ),
        copied_bytes: 0,
        snapshot_identity: None,
        snapshot_bytes: metadata.len(),
        offset: 0,
        skipping_line: false,
    });
    if cursor.identity != identity
        || cursor.source_modified != source_modified
        || cursor.snapshot_bytes != metadata.len()
        || cursor.copied_bytes > cursor.snapshot_bytes
    {
        if !initial && cursor.offset == 0 {
            return prepare(provider, session, root, cutoff, None, roots, directory);
        }
        return Err(SOURCE_CHANGED.into());
    }
    if initial {
        validate_source(&mut source, provider, session, root)?;
    }
    let target = snapshot_path(&cursor, directory)?;
    if initial && target.exists() {
        fs::remove_file(&target).map_err(|_| SOURCE_CHANGED.to_string())?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).read(true).create(initial);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let mut destination = options
        .open(&target)
        .map_err(|_| "The private import snapshot could not be written.".to_string())?;
    if !destination
        .metadata()
        .map_err(|_| SOURCE_CHANGED.to_string())?
        .is_file()
    {
        return Err(SOURCE_CHANGED.into());
    }
    // A lost transaction may leave an extra copied chunk; overwrite only that uncommitted suffix.
    destination
        .set_len(cursor.copied_bytes)
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    destination
        .seek(SeekFrom::Start(cursor.copied_bytes))
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    source
        .seek(SeekFrom::Start(cursor.copied_bytes))
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    let expected = (cursor.snapshot_bytes - cursor.copied_bytes).min(STEP_BYTES as u64);
    let copied = std::io::copy(
        &mut std::io::Read::by_ref(&mut source).take(expected),
        &mut destination,
    )
    .map_err(|_| SOURCE_CHANGED.to_string())?;
    let after = source.metadata().map_err(|_| SOURCE_CHANGED.to_string())?;
    if copied != expected
        || source_identity(&after) != cursor.identity
        || modified(&after) != cursor.source_modified
        || after.len() != cursor.snapshot_bytes
    {
        return Err(SOURCE_CHANGED.into());
    }
    destination
        .flush()
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    destination
        .sync_all()
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    cursor.copied_bytes += copied;
    if cursor.copied_bytes == cursor.snapshot_bytes {
        cursor.snapshot_identity = Some(snapshot_identity(
            &destination
                .metadata()
                .map_err(|_| SOURCE_CHANGED.to_string())?,
        ));
    }
    Ok(cursor)
}
pub(super) fn open(cursor: &SourceCursor, directory: &Path) -> Result<fs::File, String> {
    let file = open_history_file(&snapshot_path(cursor, directory)?)
        .map_err(|_| SOURCE_CHANGED.to_string())?;
    let metadata = file.metadata().map_err(|_| SOURCE_CHANGED.to_string())?;
    if cursor.snapshot_identity.as_ref() != Some(&snapshot_identity(&metadata))
        || metadata.len() != cursor.snapshot_bytes
    {
        return Err(SOURCE_CHANGED.into());
    }
    Ok(file)
}
fn snapshot_path(cursor: &SourceCursor, directory: &Path) -> Result<PathBuf, String> {
    if !cursor.snapshot_name.starts_with("import-")
        || !cursor.snapshot_name.ends_with(".snapshot")
        || cursor.snapshot_name.len() != 32
        || cursor.snapshot_name.contains('/')
        || cursor.snapshot_name.contains('\\')
    {
        return Err(SOURCE_CHANGED.into());
    }
    Ok(directory.join(&cursor.snapshot_name))
}
fn modified(metadata: &fs::Metadata) -> String {
    format!("{:?}", metadata.modified())
}
fn snapshot_identity(metadata: &fs::Metadata) -> String {
    format!("{}:{}", source_identity(metadata), modified(metadata))
}
fn hash(value: &str) -> u64 {
    value.bytes().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3)
    })
}

pub(super) fn discard(cursor: &SourceCursor, directory: &Path) {
    if let Ok(path) = snapshot_path(cursor, directory) {
        let _ = fs::remove_file(path);
    }
}
