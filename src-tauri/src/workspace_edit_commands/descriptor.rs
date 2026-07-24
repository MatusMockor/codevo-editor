fn open_descriptor_transaction_paths(
    retained_root: &File,
    relative_paths: &BTreeSet<String>,
) -> Result<BTreeMap<String, DescriptorTransactionPath>, String> {
    let mut retained_directories = BTreeMap::from([(
        String::new(),
        retained_root
            .try_clone()
            .map_err(|_| "Retained workspace root is unavailable.".to_string())?,
    )]);
    let mut paths = BTreeMap::new();

    for relative_path in relative_paths {
        validate_transaction_relative_path(relative_path)?;
        let components = Path::new(relative_path).components().collect::<Vec<_>>();
        let mut parent = retained_directories[""]
            .try_clone()
            .map_err(|_| "Retained workspace root is unavailable.".to_string())?;
        let mut parent_key = String::new();
        for component in &components[..components.len().saturating_sub(1)] {
            let Component::Normal(name) = component else {
                return Err(format!("{relative_path}: workspace edit path is unsafe"));
            };
            if !parent_key.is_empty() {
                parent_key.push('/');
            }
            parent_key.push_str(&name.to_string_lossy());
            if let Some(retained) = retained_directories.get(&parent_key) {
                parent = retained
                    .try_clone()
                    .map_err(|_| format!("{relative_path}: retained parent is unavailable"))?;
                continue;
            }
            let name = CString::new(name.as_bytes())
                .map_err(|_| format!("{relative_path}: workspace edit path contains NUL"))?;
            parent = descriptor_openat(
                &parent,
                &name,
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
            .map_err(|error| {
                format!(
                    "{relative_path}: symbolic links or non-directories are not supported: {error}"
                )
            })?;
            retained_directories.insert(
                parent_key.clone(),
                parent
                    .try_clone()
                    .map_err(|_| format!("{relative_path}: retained parent is unavailable"))?,
            );
        }
        let leaf = components
            .last()
            .and_then(|component| match component {
                Component::Normal(name) => Some(*name),
                _ => None,
            })
            .ok_or_else(|| format!("{relative_path}: workspace edit path is unsafe"))?;
        let leaf_name = CString::new(leaf.as_bytes())
            .map_err(|_| format!("{relative_path}: workspace edit path contains NUL"))?;
        paths.insert(
            relative_path.clone(),
            DescriptorTransactionPath {
                leaf_name,
                parent,
                relative_path: relative_path.clone(),
            },
        );
    }
    Ok(paths)
}

fn descriptor_openat(parent: &File, name: &CString, flags: i32) -> io::Result<File> {
    let descriptor = unsafe { libc::openat(parent.as_raw_fd(), name.as_ptr(), flags) };
    if descriptor < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

fn descriptor_create_openat(parent: &File, name: &CString, flags: i32) -> io::Result<File> {
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            flags,
            libc::c_uint::from(0o600_u16),
        )
    };
    if descriptor < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

fn descriptor_transaction_open_existing(
    path: &DescriptorTransactionPath,
) -> Result<Option<File>, String> {
    match descriptor_openat(
        &path.parent,
        &path.leaf_name,
        libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    ) {
        Ok(file) => {
            let metadata = file
                .metadata()
                .map_err(|error| format!("{}: {error}", path.relative_path))?;
            if !metadata.is_file() {
                return Err(format!(
                    "{}: only regular files are supported",
                    path.relative_path
                ));
            }
            Ok(Some(file))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("{}: {error}", path.relative_path)),
    }
}

fn descriptor_transaction_metadata(
    path: &DescriptorTransactionPath,
) -> Result<Option<fs::Metadata>, String> {
    descriptor_transaction_open_existing(path)?
        .map(|file| {
            file.metadata()
                .map_err(|error| format!("{}: {error}", path.relative_path))
        })
        .transpose()
}

pub(crate) fn descriptor_transaction_file_snapshot(
    path: &DescriptorTransactionPath,
) -> Result<TransactionFileSnapshot, String> {
    descriptor_transaction_file_snapshot_bounded(path, MAX_TRANSACTION_OUTPUT_BYTES)
}

fn descriptor_transaction_file_snapshot_bounded(
    path: &DescriptorTransactionPath,
    max_bytes: usize,
) -> Result<TransactionFileSnapshot, String> {
    match descriptor_transaction_open_existing(path)? {
        Some(file) => {
            let metadata = file
                .metadata()
                .map_err(|error| format!("{}: {error}", path.relative_path))?;
            let mut content = Vec::new();
            file.take(max_bytes.saturating_add(1) as u64)
                .read_to_end(&mut content)
                .map_err(|error| format!("{}: {error}", path.relative_path))?;
            if content.len() > max_bytes {
                return Err("Workspace edit existing-byte budget exceeded.".to_string());
            }
            Ok(TransactionFileSnapshot {
                content: Some(content),
                mode: Some(metadata.permissions().mode()),
                fingerprint: Some(transaction_fingerprint(&metadata)),
            })
        }
        None => Ok(TransactionFileSnapshot {
            content: None,
            mode: None,
            fingerprint: None,
        }),
    }
}

fn transaction_fingerprint(metadata: &fs::Metadata) -> TransactionFileFingerprint {
    TransactionFileFingerprint {
        device: metadata.dev(),
        inode: metadata.ino(),
        modified_nanoseconds: i128::from(metadata.mtime()) * 1_000_000_000
            + i128::from(metadata.mtime_nsec()),
        size: metadata.len(),
        link_count: metadata.nlink(),
    }
}

fn revalidate_descriptor_transaction_snapshot(
    path: &DescriptorTransactionPath,
    snapshot: &TransactionFileSnapshot,
) -> Result<(), String> {
    let max_bytes = snapshot.content.as_ref().map_or(0, Vec::len);
    let current = match descriptor_transaction_file_snapshot_bounded(path, max_bytes) {
        Ok(current) => current,
        Err(error) if error == "Workspace edit existing-byte budget exceeded." => {
            return Err(format!(
                "{}: file changed before transaction commit",
                path.relative_path
            ));
        }
        Err(error) => return Err(error),
    };
    if !transaction_snapshots_match(&current, snapshot) {
        return Err(format!(
            "{}: file changed before transaction commit",
            path.relative_path
        ));
    }
    Ok(())
}

fn transaction_snapshots_match(
    current: &TransactionFileSnapshot,
    expected: &TransactionFileSnapshot,
) -> bool {
    current.fingerprint == expected.fingerprint
        && current.content == expected.content
        && current.mode == expected.mode
}

fn apply_transaction_file_operations(
    state: &mut BTreeMap<String, Option<Vec<u8>>>,
    modes: &mut BTreeMap<String, Option<u32>>,
    operations: &[LanguageServerWorkspaceFileOperation],
) -> Result<(), String> {
    for operation in operations {
        match operation {
            LanguageServerWorkspaceFileOperation::Create { uri, options } => {
                if state.get(uri).and_then(Option::as_ref).is_some() {
                    if workspace_file_option(options.as_ref(), |value| value.ignore_if_exists) {
                        continue;
                    }
                    if !workspace_file_option(options.as_ref(), |value| value.overwrite) {
                        return Err(format!("{uri}: target already exists"));
                    }
                }
                state.insert(uri.clone(), Some(Vec::new()));
                modes.entry(uri.clone()).or_insert(None);
            }
            LanguageServerWorkspaceFileOperation::Rename {
                old_uri,
                new_uri,
                options,
            } => {
                if old_uri == new_uri {
                    continue;
                }
                let source = state.get(old_uri).cloned().flatten();
                let Some(source) = source else {
                    if workspace_file_option(options.as_ref(), |value| value.ignore_if_not_exists) {
                        continue;
                    }
                    return Err(format!("{old_uri}: rename source does not exist"));
                };
                let source_mode = modes.get(old_uri).copied().flatten();
                if state.get(new_uri).and_then(Option::as_ref).is_some() {
                    if workspace_file_option(options.as_ref(), |value| value.ignore_if_exists) {
                        continue;
                    }
                    if !workspace_file_option(options.as_ref(), |value| value.overwrite) {
                        return Err(format!("{new_uri}: rename target already exists"));
                    }
                }
                state.insert(old_uri.clone(), None);
                state.insert(new_uri.clone(), Some(source));
                modes.insert(old_uri.clone(), None);
                modes.insert(new_uri.clone(), source_mode);
            }
            LanguageServerWorkspaceFileOperation::Delete { uri, options } => {
                if state.get(uri).and_then(Option::as_ref).is_none() {
                    if workspace_file_option(options.as_ref(), |value| value.ignore_if_not_exists) {
                        continue;
                    }
                    return Err(format!("{uri}: delete target does not exist"));
                }
                state.insert(uri.clone(), None);
                modes.insert(uri.clone(), None);
            }
        }
    }
    Ok(())
}

fn apply_transaction_text_changes(
    state: &mut BTreeMap<String, Option<Vec<u8>>>,
    edit: &LanguageServerWorkspaceEdit,
    skipped: &BTreeSet<String>,
) -> Result<(), String> {
    for (path, edits) in &edit.changes {
        if skipped.contains(path) {
            continue;
        }
        let Some(Some(bytes)) = state.get(path) else {
            return Err(format!("{path}: text edit target does not exist"));
        };
        let content = String::from_utf8(bytes.clone())
            .map_err(|_| format!("{path}: text edit target is not UTF-8"))?;
        let workspace_edits = edits
            .iter()
            .map(|text_edit| WorkspaceTextEdit {
                path: path.clone(),
                range: WorkspaceTextRange {
                    start: WorkspaceTextPosition {
                        line: text_edit.range.start.line,
                        character: text_edit.range.start.character,
                    },
                    end: WorkspaceTextPosition {
                        line: text_edit.range.end.line,
                        character: text_edit.range.end.character,
                    },
                },
                new_text: text_edit.new_text.clone(),
            })
            .collect::<Vec<_>>();
        let updated = apply_text_edits_to_content(&content, &workspace_edits)
            .map_err(|error| format!("{path}: {error}"))?;
        state.insert(path.clone(), Some(updated.into_bytes()));
    }
    Ok(())
}

fn stage_transaction_files(
    transaction_paths: &BTreeMap<String, DescriptorTransactionPath>,
    final_state: &BTreeMap<String, Option<Vec<u8>>>,
    final_modes: &BTreeMap<String, Option<u32>>,
    file_modes: &BTreeMap<String, u32>,
    changed_paths: &[String],
) -> Result<Vec<StagedTransactionFile>, String> {
    let mut staged = Vec::new();
    for (index, relative_path) in changed_paths.iter().enumerate() {
        let Some(Some(content)) = final_state.get(relative_path) else {
            continue;
        };
        let path = &transaction_paths[relative_path];
        let (temporary_name, mut temporary_file) =
            match descriptor_create_temporary(path, "stage", index) {
                Ok(temporary) => temporary,
                Err(error) => {
                    cleanup_staged_transaction_files(&staged);
                    return Err(error);
                }
            };
        if let Err(error) = temporary_file
            .write_all(content)
            .and_then(|()| temporary_file.sync_all())
        {
            cleanup_open_transaction_file(
                &path.parent,
                &temporary_name,
                &temporary_file,
                relative_path,
                index,
            );
            cleanup_staged_transaction_files(&staged);
            return Err(format!("{relative_path}: {error}"));
        }
        if let Some(mode) = file_modes
            .get(relative_path)
            .copied()
            .or(final_modes.get(relative_path).copied().flatten())
        {
            if let Err(error) = temporary_file.set_permissions(fs::Permissions::from_mode(mode)) {
                cleanup_open_transaction_file(
                    &path.parent,
                    &temporary_name,
                    &temporary_file,
                    relative_path,
                    index,
                );
                cleanup_staged_transaction_files(&staged);
                return Err(format!("{relative_path}: {error}"));
            }
        }
        if let Err(error) = temporary_file.sync_all() {
            cleanup_open_transaction_file(
                &path.parent,
                &temporary_name,
                &temporary_file,
                relative_path,
                index,
            );
            cleanup_staged_transaction_files(&staged);
            return Err(format!("{relative_path}: {error}"));
        }
        let metadata = match temporary_file.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                cleanup_open_transaction_file(
                    &path.parent,
                    &temporary_name,
                    &temporary_file,
                    relative_path,
                    index,
                );
                cleanup_staged_transaction_files(&staged);
                return Err(format!("{relative_path}: {error}"));
            }
        };
        let parent = match path.parent.try_clone() {
            Ok(parent) => parent,
            Err(error) => {
                cleanup_open_transaction_file(
                    &path.parent,
                    &temporary_name,
                    &temporary_file,
                    relative_path,
                    index,
                );
                cleanup_staged_transaction_files(&staged);
                return Err(format!(
                    "{relative_path}: retained parent is unavailable: {error}"
                ));
            }
        };
        staged.push(StagedTransactionFile {
            parent,
            relative_path: relative_path.clone(),
            snapshot: TransactionFileSnapshot {
                content: Some(content.clone()),
                mode: Some(metadata.permissions().mode()),
                fingerprint: Some(transaction_fingerprint(&metadata)),
            },
            temporary_name,
        });
    }
    Ok(staged)
}

fn transaction_temporary_name(
    path: &DescriptorTransactionPath,
    label: &str,
    index: usize,
) -> Result<CString, String> {
    for attempt in 0..1000 {
        let candidate = CString::new(format!(
            ".{}.codevo-{label}-{}-{index}-{attempt}",
            path.leaf_name.to_string_lossy(),
            std::process::id(),
        ))
        .map_err(|_| format!("{}: temporary path contains NUL", path.relative_path))?;
        match descriptor_openat(
            &path.parent,
            &candidate,
            libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        ) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(candidate);
            }
            Ok(_) => {}
            Err(error) => return Err(format!("{}: {error}", path.relative_path)),
        }
    }
    Err(format!(
        "{}: could not reserve transaction path",
        path.relative_path
    ))
}

fn descriptor_create_temporary(
    path: &DescriptorTransactionPath,
    label: &str,
    index: usize,
) -> Result<(CString, File), String> {
    for attempt in 0..1000 {
        let candidate = CString::new(format!(
            ".{}.codevo-{label}-{}-{index}-{attempt}",
            path.leaf_name.to_string_lossy(),
            std::process::id(),
        ))
        .map_err(|_| format!("{}: temporary path contains NUL", path.relative_path))?;
        match descriptor_create_openat(
            &path.parent,
            &candidate,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        ) {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(format!("{}: {error}", path.relative_path)),
        }
    }
    Err(format!(
        "{}: could not reserve transaction path",
        path.relative_path
    ))
}

fn descriptor_rename(
    old_parent: &File,
    old_name: &CString,
    new_parent: &File,
    new_name: &CString,
) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    let result = unsafe {
        libc::renameatx_np(
            old_parent.as_raw_fd(),
            old_name.as_ptr(),
            new_parent.as_raw_fd(),
            new_name.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    #[cfg(target_os = "linux")]
    let result = unsafe {
        libc::syscall(
            libc::SYS_renameat2,
            old_parent.as_raw_fd(),
            old_name.as_ptr(),
            new_parent.as_raw_fd(),
            new_name.as_ptr(),
            libc::RENAME_NOREPLACE,
        ) as i32
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

fn transaction_snapshot_identity(
    snapshot: &TransactionFileSnapshot,
) -> Option<TransactionFileIdentity> {
    Some(TransactionFileIdentity {
        fingerprint: snapshot.fingerprint?,
        mode: snapshot.mode?,
    })
}

pub(crate) fn descriptor_file_identity(file: &File) -> io::Result<TransactionFileIdentity> {
    let metadata = file.metadata()?;
    Ok(TransactionFileIdentity {
        fingerprint: transaction_fingerprint(&metadata),
        mode: metadata.permissions().mode(),
    })
}

pub(crate) fn guarded_descriptor_cleanup(
    parent: &File,
    name: &CString,
    expected: TransactionFileIdentity,
    relative_path: &str,
    index: usize,
) -> Result<(), String> {
    #[cfg(test)]
    let terminal_hook = &mut |_: &File, _: &CString| {};
    guarded_descriptor_cleanup_implementation(
        parent,
        name,
        expected,
        relative_path,
        index,
        #[cfg(test)]
        terminal_hook,
    )
}

fn guarded_descriptor_retain_hardlink(
    parent: &File,
    name: &CString,
    expected: TransactionFileIdentity,
    relative_path: &str,
    index: usize,
) -> Result<(), String> {
    #[cfg(test)]
    let terminal_hook = &mut |_: &File, _: &CString| {};
    guarded_descriptor_cleanup_implementation(
        parent,
        name,
        expected,
        relative_path,
        index,
        #[cfg(test)]
        terminal_hook,
    )
}

#[cfg(test)]
pub(crate) fn guarded_descriptor_cleanup_with_terminal_hook(
    parent: &File,
    name: &CString,
    expected: TransactionFileIdentity,
    relative_path: &str,
    index: usize,
    mut terminal_hook: impl FnMut(&File, &CString),
) -> Result<(), String> {
    guarded_descriptor_cleanup_implementation(
        parent,
        name,
        expected,
        relative_path,
        index,
        &mut terminal_hook,
    )
}

fn guarded_descriptor_cleanup_implementation(
    parent: &File,
    name: &CString,
    expected: TransactionFileIdentity,
    relative_path: &str,
    index: usize,
    #[cfg(test)] terminal_hook: &mut dyn FnMut(&File, &CString),
) -> Result<(), String> {
    let path = DescriptorTransactionPath {
        leaf_name: name.clone(),
        parent: parent
            .try_clone()
            .map_err(|_| format!("{relative_path}: retained parent is unavailable"))?,
        relative_path: relative_path.to_string(),
    };
    let captured_name = transaction_temporary_name(&path, "recovery", index)?;
    match descriptor_rename(parent, name, parent, &captured_name) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("{relative_path}: cleanup capture failed: {error}")),
    }
    let captured_file = descriptor_openat(
        parent,
        &captured_name,
        libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    );
    let captured_identity = captured_file
        .as_ref()
        .map_err(|error| io::Error::new(error.kind(), error.to_string()))
        .and_then(descriptor_file_identity)
        .map_err(|error| format!("{relative_path}: recovery identity failed: {error}"))?;
    if captured_identity.fingerprint != expected.fingerprint
        || captured_identity.mode != expected.mode
    {
        let restore = descriptor_rename(parent, &captured_name, parent, name);
        return Err(match restore {
            Ok(()) => format!(
                "{relative_path}: foreign cleanup replacement was preserved; preserved newer data"
            ),
            Err(error) => format!(
                "{relative_path}: foreign cleanup replacement retained at {}; preserved newer data: {error}",
                captured_name.to_string_lossy()
            ),
        });
    }
    let _captured_file =
        captured_file.map_err(|error| format!("{relative_path}: recovery open failed: {error}"))?;
    #[cfg(test)]
    terminal_hook(parent, &captured_name);
    eprintln!(
        "Workspace edit retained recovery content {} without destructive inode mutation (per-transaction cap: {} files / {} bytes)",
        captured_name.to_string_lossy(),
        MAX_TRANSACTION_RECOVERY_FILES,
        MAX_TRANSACTION_RECOVERY_BYTES,
    );
    Ok(())
}

fn cleanup_open_transaction_file(
    parent: &File,
    name: &CString,
    file: &File,
    relative_path: &str,
    index: usize,
) {
    let Ok(expected) = descriptor_file_identity(file) else {
        return;
    };
    if let Err(error) = guarded_descriptor_cleanup(parent, name, expected, relative_path, index) {
        eprintln!("Workspace edit temporary cleanup failed: {error}");
    }
}

fn descriptor_link_without_overwrite(
    parent: &File,
    source: &CString,
    target: &CString,
    expected: TransactionFileIdentity,
    relative_path: &str,
    index: usize,
) -> io::Result<()> {
    let result = unsafe {
        libc::linkat(
            parent.as_raw_fd(),
            source.as_ptr(),
            parent.as_raw_fd(),
            target.as_ptr(),
            0,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    let linked = descriptor_openat(
        parent,
        source,
        libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC,
    )
    .and_then(|file| descriptor_file_identity(&file));
    let linked = match linked {
        Ok(linked)
            if linked.fingerprint.device == expected.fingerprint.device
                && linked.fingerprint.inode == expected.fingerprint.inode =>
        {
            linked
        }
        Ok(linked) => {
            let _ = guarded_descriptor_retain_hardlink(
                parent,
                target,
                linked,
                relative_path,
                index.saturating_add(1),
            );
            return Err(io::Error::other(
                "hardlink source changed before descriptor validation",
            ));
        }
        Err(error) => return Err(error),
    };
    match guarded_descriptor_retain_hardlink(parent, source, linked, relative_path, index) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = guarded_descriptor_retain_hardlink(
                parent,
                target,
                linked,
                relative_path,
                index.saturating_add(1),
            );
            Err(io::Error::other(error))
        }
    }
}

fn descriptor_named_snapshot(
    parent: &File,
    name: &CString,
    relative_path: &str,
) -> Result<TransactionFileSnapshot, String> {
    descriptor_transaction_file_snapshot(&DescriptorTransactionPath {
        leaf_name: name.clone(),
        parent: parent
            .try_clone()
            .map_err(|_| format!("{relative_path}: retained parent is unavailable"))?,
        relative_path: relative_path.to_string(),
    })
}

fn cleanup_staged_transaction_files(staged: &[StagedTransactionFile]) {
    for (index, entry) in staged.iter().enumerate() {
        let Some(expected) = transaction_snapshot_identity(&entry.snapshot) else {
            continue;
        };
        if let Err(error) = guarded_descriptor_cleanup(
            &entry.parent,
            &entry.temporary_name,
            expected,
            &entry.relative_path,
            index,
        ) {
            eprintln!("Workspace edit stage cleanup failed: {error}");
        }
    }
}

fn abort_transaction_commit(
    staged: &[StagedTransactionFile],
    committed: &[CommittedTransactionPath],
    error: String,
) -> String {
    cleanup_staged_transaction_files(staged);
    match rollback_committed_transaction_paths(committed) {
        Ok(()) => error,
        Err(rollback_error) => {
            format!("{error}; {rollback_error}")
        }
    }
}

pub(crate) fn abort_transaction_current_path(
    staged: &[StagedTransactionFile],
    committed: &[CommittedTransactionPath],
    path: &DescriptorTransactionPath,
    backup_name: Option<&CString>,
    mut error: String,
) -> String {
    if let Some(backup_name) = backup_name {
        if let Err(restore_error) =
            descriptor_rename(&path.parent, backup_name, &path.parent, &path.leaf_name)
        {
            error.push_str(&format!(
                "; original retained at {}: {restore_error}",
                backup_name.to_string_lossy()
            ));
        }
    }
    abort_transaction_commit(staged, committed, error)
}

fn rollback_committed_transaction_paths(
    committed: &[CommittedTransactionPath],
) -> Result<(), String> {
    let mut failures = Vec::new();
    for (index, entry) in committed.iter().rev().enumerate() {
        if let Err(error) = rollback_committed_transaction_path(entry, index) {
            failures.push(error);
        }
    }
    if failures.is_empty() {
        return Ok(());
    }
    Err(format!(
        "workspace edit rollback failed: {}",
        failures.join("; ")
    ))
}

fn rollback_committed_transaction_path(
    entry: &CommittedTransactionPath,
    index: usize,
) -> Result<(), String> {
    if entry.committed_snapshot.content.is_none() {
        return rollback_committed_deletion(entry);
    }

    let path = DescriptorTransactionPath {
        leaf_name: entry.leaf_name.clone(),
        parent: entry
            .parent
            .try_clone()
            .map_err(|_| format!("{}: retained parent is unavailable", entry.relative_path))?,
        relative_path: entry.relative_path.clone(),
    };
    let rollback_name = transaction_temporary_name(&path, "rollback", index)?;
    descriptor_rename(
        &entry.parent,
        &entry.leaf_name,
        &entry.parent,
        &rollback_name,
    )
    .map_err(|error| {
        format!(
            "{}: transaction output changed before rollback; preserved newer data: {error}",
            entry.relative_path
        )
    })?;
    let current =
        match descriptor_named_snapshot(&entry.parent, &rollback_name, &entry.relative_path) {
            Ok(current) => current,
            Err(error) => {
                let recovery = restore_conflicting_transaction_file(
                    entry,
                    &rollback_name,
                    "transaction output could not be validated during rollback",
                );
                return Err(format!("{error}; {recovery}"));
            }
        };
    if !transaction_snapshots_match(&current, &entry.committed_snapshot) {
        return Err(restore_conflicting_transaction_file(
            entry,
            &rollback_name,
            "transaction output changed before rollback",
        ));
    }

    if entry.backup_name.is_some() {
        if let Err(error) = restore_transaction_backup(entry) {
            let recovery = restore_conflicting_transaction_file(
                entry,
                &rollback_name,
                "rollback target changed while restoring the original file",
            );
            return Err(format!(
                "{}: original backup was not restored; {error}; {recovery}",
                entry.relative_path,
            ));
        }
    }

    let expected = transaction_snapshot_identity(&entry.committed_snapshot)
        .ok_or_else(|| format!("{}: rollback identity is unavailable", entry.relative_path))?;
    guarded_descriptor_cleanup(
        &entry.parent,
        &rollback_name,
        expected,
        &entry.relative_path,
        index,
    )
    .map_err(|error| format!("{}: rollback cleanup failed: {error}", entry.relative_path))
}

fn rollback_committed_deletion(entry: &CommittedTransactionPath) -> Result<(), String> {
    let current = descriptor_named_snapshot(&entry.parent, &entry.leaf_name, &entry.relative_path)?;
    if current.content.is_some() {
        let recovery = entry
            .backup_name
            .as_ref()
            .map(|name| format!("; original retained at {}", name.to_string_lossy()))
            .unwrap_or_default();
        return Err(format!(
            "{}: transaction output changed before rollback; preserved newer data{recovery}",
            entry.relative_path
        ));
    }
    match &entry.backup_name {
        Some(_) => restore_transaction_backup(entry),
        None => Ok(()),
    }
}

fn restore_transaction_backup(entry: &CommittedTransactionPath) -> Result<(), String> {
    let backup_name = entry
        .backup_name
        .as_ref()
        .ok_or_else(|| format!("{}: backup is unavailable", entry.relative_path))?;
    let expected = entry
        .backup_snapshot
        .as_ref()
        .ok_or_else(|| format!("{}: backup fingerprint is unavailable", entry.relative_path))?;
    let current = descriptor_named_snapshot(&entry.parent, backup_name, &entry.relative_path)?;
    if !transaction_snapshots_match(&current, expected) {
        return Err(format!(
            "{}: backup changed before rollback; retained at {}",
            entry.relative_path,
            backup_name.to_string_lossy()
        ));
    }
    let identity = transaction_snapshot_identity(expected)
        .ok_or_else(|| format!("{}: backup identity is unavailable", entry.relative_path))?;
    descriptor_link_without_overwrite(
        &entry.parent,
        backup_name,
        &entry.leaf_name,
        identity,
        &entry.relative_path,
        0,
    )
    .map_err(|error| {
        format!(
            "{}: original retained at {}; {error}",
            entry.relative_path,
            backup_name.to_string_lossy()
        )
    })
}

fn restore_conflicting_transaction_file(
    entry: &CommittedTransactionPath,
    source: &CString,
    reason: &str,
) -> String {
    let Some(expected) = transaction_snapshot_identity(&entry.committed_snapshot) else {
        return format!("{}: {reason}; newer data retained", entry.relative_path);
    };
    match descriptor_link_without_overwrite(
        &entry.parent,
        source,
        &entry.leaf_name,
        expected,
        &entry.relative_path,
        0,
    ) {
        Ok(()) => format!("{}: {reason}; preserved newer data", entry.relative_path),
        Err(error) => format!(
            "{}: {reason}; newer data retained at {}: {error}",
            entry.relative_path,
            source.to_string_lossy()
        ),
    }
}

fn rollback_workspace_edit(
    original: &BTreeMap<String, TransactionFileSnapshot>,
    final_state: &BTreeMap<String, Option<Vec<u8>>>,
    changed_paths: &[String],
) -> Result<LanguageServerWorkspaceEdit, String> {
    let mut changes = BTreeMap::new();
    let mut file_operations = Vec::new();
    for path in changed_paths {
        let before = original[path].content.as_ref();
        let after = final_state.get(path).and_then(Option::as_ref);
        match (before, after) {
            (None, Some(_)) => file_operations.push(LanguageServerWorkspaceFileOperation::Delete {
                uri: path.clone(),
                options: None,
            }),
            (Some(content), None) => {
                file_operations.push(LanguageServerWorkspaceFileOperation::Create {
                    uri: path.clone(),
                    options: None,
                });
                changes.insert(path.clone(), vec![full_file_text_edit(&[], content)?]);
            }
            (Some(content), Some(current)) => {
                changes.insert(path.clone(), vec![full_file_text_edit(current, content)?]);
            }
            (None, None) => {}
        }
    }
    Ok(LanguageServerWorkspaceEdit {
        changes,
        document_versions: BTreeMap::new(),
        file_operations,
    })
}

fn full_file_text_edit(
    current: &[u8],
    replacement: &[u8],
) -> Result<LanguageServerTextEdit, String> {
    let current = std::str::from_utf8(current).map_err(|_| "transaction content is not UTF-8")?;
    let replacement =
        std::str::from_utf8(replacement).map_err(|_| "transaction content is not UTF-8")?;
    let (line, character) = current
        .chars()
        .fold((0_u32, 0_u32), |(line, character), value| {
            if value == '\n' {
                return (line + 1, 0);
            }
            (line, character + value.len_utf16() as u32)
        });
    Ok(LanguageServerTextEdit {
        range: LanguageServerRange {
            start: LanguageServerPosition {
                line: 0,
                character: 0,
            },
            end: LanguageServerPosition { line, character },
        },
        new_text: replacement.to_string(),
    })
}

pub(crate) fn apply_descriptor_workspace_edit(
    registry: &WorkspaceRegistry,
    workspace_id: &WorkspaceId,
    edit: LanguageServerWorkspaceEdit,
    skipped_paths: &[String],
    mut after_read: impl FnMut(&Path, usize),
) -> WorkspaceEditResult {
    let repository = DescriptorFileRepository::new(registry);
    if let Err(error) = registry.descriptor(workspace_id) {
        return WorkspaceEditResult::NotFound {
            applied_file_operations: 0,
            applied_text_files: 0,
            applied_count: 0,
            failed_path: "<workspace>".into(),
            message: error.to_string(),
        };
    }
    let mut applied_file_operations = 0;
    for operation in &edit.file_operations {
        match apply_descriptor_file_operation(&repository, workspace_id, operation) {
            Ok(changed) => applied_file_operations += changed,
            Err((path, message, partial)) => {
                return workspace_edit_failure(
                    applied_file_operations,
                    0,
                    &path,
                    message,
                    partial || applied_file_operations > 0,
                );
            }
        }
    }

    let skipped = skipped_paths.iter().cloned().collect::<BTreeSet<_>>();
    let mut edits_by_path = BTreeMap::<String, Vec<WorkspaceTextEdit>>::new();
    for (path, edits) in edit.changes {
        if skipped.contains(&path) {
            continue;
        }
        for text_edit in edits {
            edits_by_path
                .entry(path.clone())
                .or_default()
                .push(WorkspaceTextEdit {
                    path: path.clone(),
                    range: WorkspaceTextRange {
                        start: WorkspaceTextPosition {
                            line: text_edit.range.start.line,
                            character: text_edit.range.start.character,
                        },
                        end: WorkspaceTextPosition {
                            line: text_edit.range.end.line,
                            character: text_edit.range.end.character,
                        },
                    },
                    new_text: text_edit.new_text,
                });
        }
    }

    let mut applied_text_files = 0;
    for (path, edits) in edits_by_path {
        let snapshot = match repository.read_text(workspace_id, Path::new(&path)) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                return workspace_edit_failure(
                    applied_file_operations,
                    applied_text_files,
                    &path,
                    error.to_string(),
                    applied_file_operations + applied_text_files > 0,
                );
            }
        };
        let content = match apply_text_edits_to_content(&snapshot.content, &edits) {
            Ok(content) => content,
            Err(error) => {
                return workspace_edit_failure(
                    applied_file_operations,
                    applied_text_files,
                    &path,
                    error.to_string(),
                    applied_file_operations + applied_text_files > 0,
                );
            }
        };
        after_read(Path::new(&path), applied_text_files);
        if content == snapshot.content {
            continue;
        }
        match repository.save_text(workspace_id, Path::new(&path), &content, &snapshot.revision) {
            FileCommandResult::Success { .. } => applied_text_files += 1,
            FileCommandResult::Conflict { message } => {
                if applied_file_operations + applied_text_files == 0 {
                    return WorkspaceEditResult::Conflict {
                        applied_file_operations,
                        applied_text_files,
                        applied_count: 0,
                        failed_path: path,
                        message,
                    };
                }
                return workspace_edit_failure(
                    applied_file_operations,
                    applied_text_files,
                    &path,
                    message,
                    true,
                );
            }
            FileCommandResult::Partial { message, .. } => {
                return workspace_edit_failure(
                    applied_file_operations,
                    applied_text_files,
                    &path,
                    message,
                    true,
                );
            }
            FileCommandResult::Error { message } => {
                return workspace_edit_failure(
                    applied_file_operations,
                    applied_text_files,
                    &path,
                    message,
                    applied_file_operations + applied_text_files > 0,
                );
            }
        }
    }

    WorkspaceEditResult::Success {
        applied_file_operations,
        applied_text_files,
        applied_count: applied_file_operations + applied_text_files,
    }
}

fn workspace_edit_failure(
    applied_file_operations: usize,
    applied_text_files: usize,
    failed_path: &str,
    message: String,
    partial: bool,
) -> WorkspaceEditResult {
    let applied_count = applied_file_operations + applied_text_files;
    let failed_path = failed_path.to_string();
    if partial {
        return WorkspaceEditResult::Partial {
            applied_file_operations,
            applied_text_files,
            applied_count,
            failed_path,
            message,
        };
    }
    WorkspaceEditResult::Error {
        applied_file_operations,
        applied_text_files,
        applied_count,
        failed_path,
        message,
    }
}

fn apply_descriptor_file_operation(
    repository: &DescriptorFileRepository<'_>,
    workspace_id: &WorkspaceId,
    operation: &LanguageServerWorkspaceFileOperation,
) -> Result<usize, (String, String, bool)> {
    match operation {
        LanguageServerWorkspaceFileOperation::Create { uri, options } => {
            let path = Path::new(uri);
            if descriptor_path_exists(repository, workspace_id, path) {
                if workspace_file_option(options.as_ref(), |value| value.ignore_if_exists) {
                    return Ok(0);
                }
                if workspace_file_option(options.as_ref(), |value| value.overwrite) {
                    let snapshot = repository
                        .read_text(workspace_id, path)
                        .map_err(|error| (uri.clone(), error.to_string(), false))?;
                    return mutation_from_save(
                        uri,
                        repository.save_text(workspace_id, path, "", &snapshot.revision),
                    );
                }
                return Err((
                    uri.clone(),
                    "Cannot create file because target already exists.".into(),
                    false,
                ));
            }
            mutation_from_result(uri, repository.create_file(workspace_id, path))
        }
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri,
            new_uri,
            options,
        } => {
            if old_uri == new_uri {
                return Ok(0);
            }
            if !descriptor_path_exists(repository, workspace_id, Path::new(old_uri))
                && workspace_file_option(options.as_ref(), |value| value.ignore_if_not_exists)
            {
                return Ok(0);
            }
            if descriptor_path_exists(repository, workspace_id, Path::new(new_uri))
                && workspace_file_option(options.as_ref(), |value| value.ignore_if_exists)
            {
                return Ok(0);
            }
            let overwrite = workspace_file_option(options.as_ref(), |value| value.overwrite);
            mutation_from_result(
                old_uri,
                repository.rename(
                    workspace_id,
                    Path::new(old_uri),
                    Path::new(new_uri),
                    overwrite,
                ),
            )
        }
        LanguageServerWorkspaceFileOperation::Delete { uri, options } => {
            if !descriptor_path_exists(repository, workspace_id, Path::new(uri))
                && workspace_file_option(options.as_ref(), |value| value.ignore_if_not_exists)
            {
                return Ok(0);
            }
            if !workspace_file_option(options.as_ref(), |value| value.recursive)
                && repository
                    .read_directory(workspace_id, Path::new(uri))
                    .is_ok()
            {
                return Err((
                    uri.clone(),
                    "Cannot delete directory without the recursive option.".into(),
                    false,
                ));
            }
            mutation_from_result(uri, repository.delete(workspace_id, Path::new(uri)))
        }
    }
}

fn descriptor_path_exists(
    repository: &DescriptorFileRepository<'_>,
    workspace_id: &WorkspaceId,
    path: &Path,
) -> bool {
    repository.read_text(workspace_id, path).is_ok()
        || repository.read_directory(workspace_id, path).is_ok()
}

fn mutation_from_result(
    path: &str,
    result: MutationResult,
) -> Result<usize, (String, String, bool)> {
    match result {
        MutationResult::Success => Ok(1),
        MutationResult::Partial { message } => Err((path.into(), message, true)),
        MutationResult::Error { message } => Err((path.into(), message, false)),
    }
}

fn mutation_from_save(
    path: &str,
    result: FileCommandResult,
) -> Result<usize, (String, String, bool)> {
    match result {
        FileCommandResult::Success { .. } => Ok(1),
        FileCommandResult::Partial { message, .. } => Err((path.into(), message, true)),
        FileCommandResult::Conflict { message } | FileCommandResult::Error { message } => {
            Err((path.into(), message, false))
        }
    }
}

fn apply_workspace_file_operations(
    repository: &dyn WorkspaceFileRepository,
    operations: &[LanguageServerWorkspaceFileOperation],
) -> Result<usize, String> {
    let mut changed_paths = 0;

    for operation in operations {
        changed_paths += apply_workspace_file_operation(repository, operation)?;
    }

    Ok(changed_paths)
}

fn apply_workspace_file_operation(
    repository: &dyn WorkspaceFileRepository,
    operation: &LanguageServerWorkspaceFileOperation,
) -> Result<usize, String> {
    match operation {
        LanguageServerWorkspaceFileOperation::Create { uri, options } => {
            apply_create_file_operation(repository, uri, options.as_ref())
        }
        LanguageServerWorkspaceFileOperation::Rename {
            old_uri,
            new_uri,
            options,
        } => apply_rename_file_operation(repository, old_uri, new_uri, options.as_ref()),
        LanguageServerWorkspaceFileOperation::Delete { uri, options } => {
            apply_delete_file_operation(repository, uri, options.as_ref())
        }
    }
}

fn apply_create_file_operation(
    repository: &dyn WorkspaceFileRepository,
    uri: &str,
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
) -> Result<usize, String> {
    let Some(path) = path_from_file_uri(uri).map(PathBuf::from) else {
        return Ok(0);
    };

    if path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_exists) {
            return Ok(0);
        }

        if workspace_file_option(options, |options| options.overwrite) {
            repository
                .write_text_file(&path, "")
                .map_err(|error| error.to_string())?;
            return Ok(1);
        }

        return Err("Cannot create file because target already exists.".to_string());
    }

    repository
        .create_text_file(&path)
        .map_err(|error| error.to_string())?;

    Ok(1)
}

fn apply_rename_file_operation(
    repository: &dyn WorkspaceFileRepository,
    old_uri: &str,
    new_uri: &str,
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
) -> Result<usize, String> {
    let Some(old_path) = path_from_file_uri(old_uri).map(PathBuf::from) else {
        return Ok(0);
    };
    let Some(new_path) = path_from_file_uri(new_uri).map(PathBuf::from) else {
        return Ok(0);
    };

    if old_path == new_path {
        return Ok(0);
    }

    if !old_path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_not_exists) {
            return Ok(0);
        }

        return Err("Cannot rename file because source does not exist.".to_string());
    }

    if new_path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_exists) {
            return Ok(0);
        }

        if workspace_file_option(options, |options| options.overwrite) {
            repository
                .delete_path(&new_path)
                .map_err(|error| error.to_string())?;
        } else {
            return Err("Cannot rename file because target already exists.".to_string());
        }
    }

    repository
        .rename_path(&old_path, &new_path)
        .map_err(|error| error.to_string())?;

    Ok(1)
}

fn apply_delete_file_operation(
    repository: &dyn WorkspaceFileRepository,
    uri: &str,
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
) -> Result<usize, String> {
    let Some(path) = path_from_file_uri(uri).map(PathBuf::from) else {
        return Ok(0);
    };

    if !path.exists() {
        if workspace_file_option(options, |options| options.ignore_if_not_exists) {
            return Ok(0);
        }

        return Err("Cannot delete file because path does not exist.".to_string());
    }

    if path.is_dir() && !workspace_file_option(options, |options| options.recursive) {
        return Err("Cannot delete directory without the recursive option.".to_string());
    }

    repository
        .delete_path(&path)
        .map_err(|error| error.to_string())?;

    Ok(1)
}

fn workspace_file_option(
    options: Option<&LanguageServerWorkspaceFileOperationOptions>,
    pick: impl FnOnce(&LanguageServerWorkspaceFileOperationOptions) -> Option<bool>,
) -> bool {
    options.and_then(pick).unwrap_or(false)
}

pub(crate) fn workspace_text_edits_from_language_server(
    edit: LanguageServerWorkspaceEdit,
) -> Result<Vec<WorkspaceTextEdit>, String> {
    let mut edits = Vec::new();

    for (uri, uri_edits) in edit.changes {
        let Some(path) = path_from_file_uri(&uri) else {
            continue;
        };

        for text_edit in uri_edits {
            edits.push(WorkspaceTextEdit {
                path: path.clone(),
                range: WorkspaceTextRange {
                    start: WorkspaceTextPosition {
                        line: text_edit.range.start.line,
                        character: text_edit.range.start.character,
                    },
                    end: WorkspaceTextPosition {
                        line: text_edit.range.end.line,
                        character: text_edit.range.end.character,
                    },
                },
                new_text: text_edit.new_text,
            });
        }
    }

    Ok(edits)
}
